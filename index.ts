import cors from "cors";
import dotenv from "dotenv";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  MongoClient,
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
    role?: string;
    accountType?: string;
    [key: string]: unknown;
  };
  session?: {
    [key: string]: unknown;
  };
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
      database.collection("user");

    const sessionCollection =
      database.collection("session");

    // Verification related

    const findUserById = async ( userId: unknown,) => {
      if (!userId) {
        return null;
      }

      return userCollection.findOne({
        $expr: {
          $eq: [
            {
              $toString: "$_id",
            },
            String(userId),
          ],
        },
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
            session.expiresAt,
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

        const authenticatedRequest =req as AuthenticatedRequest;

        authenticatedRequest.user = user;
        authenticatedRequest.session = session;

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
      const authenticatedRequest =req as AuthenticatedRequest;

      if (authenticatedRequest.user?.role !=="admin") {
        return res.status(403).json({
          message: "Admin access required.",
        });
      }

      next();
    };

    const verifyCustomer = (req: Request,res: Response, next: NextFunction,) => {
      const authenticatedRequest =
        req as AuthenticatedRequest;

      const user =authenticatedRequest.user;

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

    const verifyRestaurantOwner = (req: Request,res: Response,next: NextFunction,) => {
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

    // Restaurant, reservation, review and user API routes

    // await client
    //   .db("admin")
    //   .command({ ping: 1 });

    console.log(
      "DineSpot database setup is ready!",
    );

    void restaurantCollection;
    void reservationCollection;
    void reviewCollection;

    void verifyToken;
    void verifyAdmin;
    void verifyCustomer;
    void verifyRestaurantOwner;
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