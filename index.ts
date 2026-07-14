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
      database.collection<UserDocument>("users");

    const sessionCollection =
      database.collection("sessions");

    // =====================================================
    // HELPER FUNCTIONS
    // =====================================================

    const getAuthUser = (req: Request) => {
      const authRequest =
        req as AuthenticatedRequest;

      return authRequest.user;
    };

    const getOwnerFilter = (
      user: AuthenticatedRequest["user"],
    ) => ({
      $or: [
        {
          ownerId: String(user?._id || ""),
        },
        {
          ownerEmail: String(user?.email || ""),
        },
      ],
    });

    const getObjectId = (
      value: string | string[],
    ) => {
      if (
        Array.isArray(value) ||
        !ObjectId.isValid(value)
      ) {
        return null;
      }

      return new ObjectId(value);
    };

    // =====================================================
    // VERIFICATION RELATED
    // =====================================================

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
      const user = getAuthUser(req);

      if (user?.role !== "admin") {
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
      const user = getAuthUser(req);

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
      const user = getAuthUser(req);

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

    // =====================================================
    // RESTAURANT OWNER API
    // =====================================================

    // Restaurant owner creates only one restaurant
    app.post(
      "/api/restaurants",
      verifyToken,
      verifyRestaurantOwner,
      async (req, res) => {
        try {
          const user = getAuthUser(req);
          const restaurantData =
            req.body || {};

          const ownerFilter =
            getOwnerFilter(user);

          const existingRestaurant =
            await restaurantCollection.findOne(
              ownerFilter,
            );

          if (existingRestaurant) {
            return res.status(409).json({
              message:
                "You already have a restaurant. One owner can create only one restaurant.",
            });
          }

          const name = String(
            restaurantData.name || "",
          ).trim();

          const cuisine = String(
            restaurantData.cuisine || "",
          ).trim();

          const location = String(
            restaurantData.location || "",
          ).trim();

          if (!name) {
            return res.status(400).json({
              message:
                "Restaurant name is required.",
            });
          }

          if (!cuisine) {
            return res.status(400).json({
              message: "Cuisine is required.",
            });
          }

          if (!location) {
            return res.status(400).json({
              message:
                "Restaurant location is required.",
            });
          }

          const newRestaurant = {
            ...restaurantData,
            name,
            cuisine,
            location,
            ownerId: String(user?._id || ""),
            ownerEmail: String(
              user?.email || "",
            ),
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

    // Restaurant owner gets their restaurant
    app.get(
      "/api/my/restaurants",
      verifyToken,
      verifyRestaurantOwner,
      async (req, res) => {
        try {
          const user = getAuthUser(req);

          const restaurants =
            await restaurantCollection
              .find(getOwnerFilter(user))
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

    // Restaurant owner updates their restaurant
    app.patch(
      "/api/restaurants/:id",
      verifyToken,
      verifyRestaurantOwner,
      async (req, res) => {
        try {
          const restaurantId = getObjectId(
            req.params.id,
          );

          if (!restaurantId) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const user = getAuthUser(req);
          const ownerFilter =
            getOwnerFilter(user);

          const existingRestaurant =
            await restaurantCollection.findOne({
              _id: restaurantId,
              ...ownerFilter,
            });

          if (!existingRestaurant) {
            return res.status(404).json({
              message:
                "Restaurant was not found or you cannot update it.",
            });
          }

          const restaurantData =
            req.body || {};

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

          const updateData: Record<
            string,
            unknown
          > = {
            ...restaurantData,
          };

          delete updateData._id;
          delete updateData.ownerId;
          delete updateData.ownerEmail;
          delete updateData.status;
          delete updateData.createdAt;
          delete updateData.approvedAt;
          delete updateData.approvedBy;
          delete updateData.rejectedAt;
          delete updateData.rejectedBy;
          delete updateData.averageRating;
          delete updateData.reviewCount;

          if (updateData.name !== undefined) {
            updateData.name = String(
              updateData.name,
            ).trim();
          }

          if (
            updateData.cuisine !== undefined
          ) {
            updateData.cuisine = String(
              updateData.cuisine,
            ).trim();
          }

          if (
            updateData.location !== undefined
          ) {
            updateData.location = String(
              updateData.location,
            ).trim();
          }

          if (
            Object.keys(updateData).length === 0
          ) {
            return res.status(400).json({
              message:
                "No restaurant information was provided.",
            });
          }

          updateData.updatedAt = new Date();

          await restaurantCollection.updateOne(
            {
              _id: restaurantId,
              ...ownerFilter,
            },
            {
              $set: updateData,
            },
          );

          const updatedRestaurant =
            await restaurantCollection.findOne({
              _id: restaurantId,
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

    // Restaurant owner deletes their restaurant
    app.delete(
      "/api/restaurants/:id",
      verifyToken,
      verifyRestaurantOwner,
      async (req, res) => {
        try {
          const restaurantId = getObjectId(
            req.params.id,
          );

          if (!restaurantId) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const user = getAuthUser(req);

          const result =
            await restaurantCollection.deleteOne({
              _id: restaurantId,
              ...getOwnerFilter(user),
            });

          if (!result.deletedCount) {
            return res.status(404).json({
              message:
                "Restaurant was not found or you cannot delete it.",
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

    // =====================================================
    // PUBLIC RESTAURANT API
    // =====================================================

    // Public approved restaurant list
    app.get(
      "/api/restaurants",
      async (_req, res) => {
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

    // Public approved restaurant details
    app.get(
      "/api/restaurants/:id",
      async (req, res) => {
        try {
          const restaurantId = getObjectId(
            req.params.id,
          );

          if (!restaurantId) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const restaurant =
            await restaurantCollection.findOne({
              _id: restaurantId,
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

    // =====================================================
    // ADMIN RESTAURANT API
    // =====================================================

    // Admin gets all restaurants
    app.get(
      "/api/admin/restaurants",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const status = String(
            req.query.status || "",
          ).toLowerCase();

          const search = String(
            req.query.search || "",
          ).trim();

          const query: Record<
            string,
            unknown
          > = {};

          if (
            [
              "pending",
              "approved",
              "rejected",
            ].includes(status)
          ) {
            query.status = status;
          }

          if (search) {
            const safeSearch = search.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );

            const searchRegex = new RegExp(
              safeSearch,
              "i",
            );

            query.$or = [
              {
                name: searchRegex,
              },
              {
                cuisine: searchRegex,
              },
              {
                location: searchRegex,
              },
              {
                ownerEmail: searchRegex,
              },
            ];
          }

          const restaurants =
            await restaurantCollection
              .find(query)
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(restaurants);
        } catch (error) {
          console.error(
            "Admin restaurants fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch restaurants.",
          });
        }
      },
    );

    // Admin approves or rejects a restaurant
    app.patch(
      "/api/admin/restaurants/:id/status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const restaurantId = getObjectId(
            req.params.id,
          );

          if (!restaurantId) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const status = String(
            req.body?.status || "",
          ).toLowerCase();

          const allowedStatuses = [
            "pending",
            "approved",
            "rejected",
          ];

          if (
            !allowedStatuses.includes(status)
          ) {
            return res.status(400).json({
              message:
                "Invalid restaurant status.",
              allowedStatuses,
            });
          }

          const admin = getAuthUser(req);
          const now = new Date();

          const updateData: Record<
            string,
            unknown
          > = {
            status,
            updatedAt: now,
            moderatedAt: now,
            moderatedBy: String(
              admin?._id || "",
            ),
            moderatedByEmail: String(
              admin?.email || "",
            ),
          };

          if (status === "approved") {
            updateData.approvedAt = now;
            updateData.approvedBy = String(
              admin?._id || "",
            );
            updateData.rejectedAt = null;
            updateData.rejectedBy = null;
          }

          if (status === "rejected") {
            updateData.rejectedAt = now;
            updateData.rejectedBy = String(
              admin?._id || "",
            );
            updateData.approvedAt = null;
            updateData.approvedBy = null;
          }

          if (status === "pending") {
            updateData.approvedAt = null;
            updateData.approvedBy = null;
            updateData.rejectedAt = null;
            updateData.rejectedBy = null;
          }

          const result =
            await restaurantCollection.updateOne(
              {
                _id: restaurantId,
              },
              {
                $set: updateData,
              },
            );

          if (!result.matchedCount) {
            return res.status(404).json({
              message:
                "Restaurant was not found.",
            });
          }

          const updatedRestaurant =
            await restaurantCollection.findOne({
              _id: restaurantId,
            });

          res.json({
            success: true,
            message: `Restaurant status changed to ${status}.`,
            restaurant: updatedRestaurant,
          });
        } catch (error) {
          console.error(
            "Restaurant status update error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to update restaurant status.",
          });
        }
      },
    );

    // Admin deletes any restaurant
    app.delete(
      "/api/admin/restaurants/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const restaurantId = getObjectId(
            req.params.id,
          );

          if (!restaurantId) {
            return res.status(400).json({
              message:
                "Invalid restaurant ID.",
            });
          }

          const result =
            await restaurantCollection.deleteOne({
              _id: restaurantId,
            });

          if (!result.deletedCount) {
            return res.status(404).json({
              message:
                "Restaurant was not found.",
            });
          }

          res.json({
            success: true,
            message:
              "Restaurant deleted successfully.",
          });
        } catch (error) {
          console.error(
            "Admin restaurant delete error:",
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