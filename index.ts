import cors from "cors";
import dotenv from "dotenv";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  MongoClient,
  ObjectId,
  ServerApiVersion,
} from "mongodb";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("DineSpot server is running!");
});

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    "MONGODB_URI is missing in the .env file.",
  );
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

type AuthenticatedRequest = Request & {
  user?: {
    _id?: unknown;
    name?: string;
    email?: string;
    role?: string;
    accountType?: string;
    [key: string]: unknown;
  };
  session?: {
    userId?: unknown;
    token?: string;
    expiresAt?: unknown;
    [key: string]: unknown;
  };
};

type UserDocument = {
  _id: string | ObjectId;
  name?: string;
  email?: string;
  role?: string;
  accountType?: string;
  [key: string]: unknown;
};

async function run() {
  try {
    // await client.connect();

    const database = client.db("dinespot");

    const restaurantCollection =
      database.collection("restaurants");

    const reservationCollection =
      database.collection("reservations");

    const reviewCollection =
      database.collection("reviews");

    const userCollection =
      database.collection<UserDocument>("user");

    const sessionCollection =
      database.collection("session");


    // VERIFICATION RELATED
    const findUserById = async (
      userId: unknown,
    ) => {
      if (!userId) {
        return null;
      }

      const possibleIds: Array<
        string | ObjectId
      > = [String(userId)];

      if (ObjectId.isValid(String(userId))) {
        possibleIds.push(
          new ObjectId(String(userId)),
        );
      }

      return userCollection.findOne({
        $or: possibleIds.map((id) => ({
          _id: id,
        })),
      });
    };

    const verifyToken = async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const authHeader =
          req.headers.authorization || "";

        const [scheme, token] =
          authHeader.split(" ");

        if (scheme !== "Bearer" || !token) {
          return res.status(401).json({
            message: "Unauthorized access.",
          });
        }

        const session =
          await sessionCollection.findOne({
            token,
          });

        if (!session) {
          return res.status(401).json({
            message:
              "Invalid or expired session.",
          });
        }

        if (
          session.expiresAt &&
          new Date(
            String(session.expiresAt),
          ).getTime() < Date.now()
        ) {
          return res.status(401).json({
            message: "Session expired.",
          });
        }

        const user = await findUserById(
          session.userId,
        );

        if (!user) {
          return res.status(401).json({
            message:
              "Session user was not found.",
          });
        }

        const authenticatedRequest =
          req as AuthenticatedRequest;

        authenticatedRequest.user = user;
        authenticatedRequest.session =
          session;

        next();
      } catch (error) {
        console.error(
          "Token verification error:",
          error,
        );

        res.status(500).json({
          message: "Failed to verify user.",
        });
      }
    };

    const verifyAdmin = (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      const authenticatedRequest =
        req as AuthenticatedRequest;

      if (
        authenticatedRequest.user?.role !==
        "admin"
      ) {
        return res.status(403).json({
          message: "Admin access required.",
        });
      }

      next();
    };

    const verifyCustomer = (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      const authenticatedRequest =
        req as AuthenticatedRequest;

      const user =
        authenticatedRequest.user;

      if (
        user?.role !== "user" ||
        user?.accountType ===
          "restaurant_owner"
      ) {
        return res.status(403).json({
          message: "Customer access required.",
        });
      }

      next();
    };

    const verifyRestaurantOwner = (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      const authenticatedRequest =
        req as AuthenticatedRequest;

      const user =
        authenticatedRequest.user;

      if (
        user?.role !== "user" ||
        user?.accountType !==
          "restaurant_owner"
      ) {
        return res.status(403).json({
          message:
            "Restaurant owner access required.",
        });
      }

      next();
    };


    // RESTAURANT API


    // Restaurant owner creates a restaurant
  app.post("/api/restaurants",verifyToken, verifyRestaurantOwner,async (req, res) => {
    try {
      const authenticatedRequest =
        req as AuthenticatedRequest;

      const user = authenticatedRequest.user;
      const restaurantData = req.body || {};

      const ownerId = String(user?._id || "");
      const ownerEmail = String(user?.email || "");

      // Check whether this owner already has a restaurant
      const existingRestaurant =
        await restaurantCollection.findOne({
          $or: [
            {
              ownerId,
            },
            {
              ownerEmail,
            },
          ],
        });

      if (existingRestaurant) {
        return res.status(409).json({
          message:
            "You already have a restaurant. One owner can create only one restaurant.",
        });
      }

      if (!restaurantData.name) {
        return res.status(400).json({
          message: "Restaurant name is required.",
        });
      }

      if (!restaurantData.cuisine) {
        return res.status(400).json({
          message: "Cuisine is required.",
        });
      }

      if (!restaurantData.location) {
        return res.status(400).json({
          message:
            "Restaurant location is required.",
        });
      }

      const newRestaurant = {
        ...restaurantData,

        name: String(
          restaurantData.name,
        ).trim(),

        cuisine: String(
          restaurantData.cuisine,
        ).trim(),

        location: String(
          restaurantData.location,
        ).trim(),

        ownerId,
        ownerEmail,

        status: "pending",

        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result =
        await restaurantCollection.insertOne(
          newRestaurant,
        );

      res.status(201).json({
        success: true,
        message:
          "Restaurant submitted successfully.",

        insertedId: result.insertedId,

        restaurant: {
          ...newRestaurant,
          _id: result.insertedId,
        },
      });
    } catch (error) {
      console.error(
        "Restaurant create error:",
        error,
      );

      res.status(500).json({
        message:
          "Failed to create restaurant.",
      });
    }
  },
);

    // Public approved restaurant list
    app.get("/api/restaurants",async (_req, res) => {
        try {
          const restaurants =
            await restaurantCollection
              .find({
                status: "approved",
              })
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(restaurants);
        } catch (error) {
          console.error(
            "Restaurants fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch restaurants.",
          });
        }
      },
    );



    // await client
    //   .db("admin")
    //   .command({ ping: 1 });

    console.log(
      "DineSpot database setup is ready!",
    );

    void reservationCollection;
    void reviewCollection;
    void verifyAdmin;
    void verifyCustomer;
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(
    `DineSpot server running on port ${port}`,
  );
});