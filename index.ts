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


    // Restaurant owner creates only one restaurant
    app.post(
      "/api/restaurants",verifyToken,verifyRestaurantOwner,async (req, res) => {
        try {
          const authenticatedRequest =
            req as AuthenticatedRequest;

          const user =
            authenticatedRequest.user;

          const restaurantData =
            req.body || {};

          const ownerId = String(
            user?._id || "",
          );

          const ownerEmail = String(
            user?.email || "",
          );

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

          if (
            !String(
              restaurantData.name || "",
            ).trim()
          ) {
            return res.status(400).json({
              message:
                "Restaurant name is required.",
            });
          }

          if (
            !String(
              restaurantData.cuisine || "",
            ).trim()
          ) {
            return res.status(400).json({
              message: "Cuisine is required.",
            });
          }

          if (
            !String(
              restaurantData.location || "",
            ).trim()
          ) {
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

    // Restaurant owner gets their own restaurant
    app.get("/api/my/restaurants",verifyToken,verifyRestaurantOwner,async (req, res) => {
        try {
          const authenticatedRequest =
            req as AuthenticatedRequest;

          const user =
            authenticatedRequest.user;

          const ownerId = String(
            user?._id || "",
          );

          const ownerEmail = String(
            user?.email || "",
          );

          const restaurants =
            await restaurantCollection
              .find({
                $or: [
                  {
                    ownerId,
                  },
                  {
                    ownerEmail,
                  },
                ],
              })
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(restaurants);
        } catch (error) {
          console.error(
            "Owner restaurant fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch your restaurant.",
          });
        }
      },
    );

    // Public single approved restaurant details
    app.get("/api/restaurants/:id",async (req, res) => {
        try {
          const rawId = req.params.id;

          if (Array.isArray(rawId)) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const id = rawId;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const restaurant =
            await restaurantCollection.findOne({
              _id: new ObjectId(String(id)),
              status: "approved",
            });

          if (!restaurant) {
            return res.status(404).json({
              message:
                "Restaurant was not found.",
            });
          }

          res.json(restaurant);
        } catch (error) {
          console.error(
            "Restaurant details fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch restaurant details.",
          });
        }
      },
    );

    // Restaurant owner updates their own restaurant
    app.patch("/api/restaurants/:id",verifyToken,verifyRestaurantOwner,async (req, res) => {
        try {
          const authenticatedRequest =
            req as AuthenticatedRequest;

          const user =
            authenticatedRequest.user;

          const rawId = req.params.id;
          const restaurantData =
            req.body || {};

          if (Array.isArray(rawId)) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const id = rawId;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const ownerId = String(
            user?._id || "",
          );

          const ownerEmail = String(
            user?.email || "",
          );

          const existingRestaurant =
            await restaurantCollection.findOne({
              _id: new ObjectId(id),

              $or: [
                {
                  ownerId,
                },
                {
                  ownerEmail,
                },
              ],
            });

          if (!existingRestaurant) {
            return res.status(404).json({
              message:
                "Restaurant was not found or you do not have permission to update it.",
            });
          }

          if (
            restaurantData.name !==
              undefined &&
            !String(
              restaurantData.name,
            ).trim()
          ) {
            return res.status(400).json({
              message:
                "Restaurant name cannot be empty.",
            });
          }

          if (
            restaurantData.cuisine !==
              undefined &&
            !String(
              restaurantData.cuisine,
            ).trim()
          ) {
            return res.status(400).json({
              message:
                "Cuisine cannot be empty.",
            });
          }

          if (
            restaurantData.location !==
              undefined &&
            !String(
              restaurantData.location,
            ).trim()
          ) {
            return res.status(400).json({
              message:
                "Restaurant location cannot be empty.",
            });
          }

          const updatedRestaurantData = {
            ...restaurantData,
          };

          delete updatedRestaurantData._id;
          delete updatedRestaurantData.ownerId;
          delete updatedRestaurantData.ownerEmail;
          delete updatedRestaurantData.status;
          delete updatedRestaurantData.createdAt;
          delete updatedRestaurantData.approvedAt;
          delete updatedRestaurantData.approvedBy;
          delete updatedRestaurantData.averageRating;
          delete updatedRestaurantData.reviewCount;

          if (
            updatedRestaurantData.name !==
            undefined
          ) {
            updatedRestaurantData.name =
              String(
                updatedRestaurantData.name,
              ).trim();
          }

          if (
            updatedRestaurantData.cuisine !==
            undefined
          ) {
            updatedRestaurantData.cuisine =
              String(
                updatedRestaurantData.cuisine,
              ).trim();
          }

          if (
            updatedRestaurantData.location !==
            undefined
          ) {
            updatedRestaurantData.location =
              String(
                updatedRestaurantData.location,
              ).trim();
          }

          if (
            Object.keys(
              updatedRestaurantData,
            ).length === 0
          ) {
            return res.status(400).json({
              message:
                "No restaurant information was provided.",
            });
          }

          updatedRestaurantData.updatedAt =
            new Date();

          await restaurantCollection.updateOne(
            {
              _id: new ObjectId(String(id)),

              $or: [
                {
                  ownerId,
                },
                {
                  ownerEmail,
                },
              ],
            },
            {
              $set: updatedRestaurantData,
            },
          );

          const updatedRestaurant =
            await restaurantCollection.findOne({
              _id: new ObjectId(String(id)),
            });

          res.json({
            success: true,
            message:
              "Restaurant updated successfully.",
            restaurant: updatedRestaurant,
          });
        } catch (error) {
          console.error(
            "Restaurant update error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to update restaurant.",
          });
        }
      },
    );

    // Restaurant owner deletes their own restaurant
    app.delete("/api/restaurants/:id",verifyToken,verifyRestaurantOwner,async (req, res) => {
        try {
          const authenticatedRequest =
            req as AuthenticatedRequest;

          const user =
            authenticatedRequest.user;

          const rawId = req.params.id;

          if (Array.isArray(rawId)) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const id = rawId;

          if (!ObjectId.isValid(id)) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const ownerId = String(
            user?._id || "",
          );

          const ownerEmail = String(
            user?.email || "",
          );

          const result =
            await restaurantCollection.deleteOne({
              _id: new ObjectId(String(id)),

              $or: [
                {
                  ownerId,
                },
                {
                  ownerEmail,
                },
              ],
            });

          if (!result.deletedCount) {
            return res.status(404).json({
              message:
                "Restaurant was not found or you do not have permission to delete it.",
            });
          }

          res.json({
            success: true,
            message:
              "Restaurant deleted successfully.",
          });
        } catch (error) {
          console.error(
            "Restaurant delete error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to delete restaurant.",
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