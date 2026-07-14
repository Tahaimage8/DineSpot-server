import cors from "cors";
import dotenv from "dotenv";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  type Filter,
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
    role?: string | null;
    accountType?: string | null;
    isBlocked?: boolean;
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
  role?: string | null;
  accountType?: string | null;
  isBlocked?: boolean;
  blockedAt?: Date | null;
  blockedBy?: string | null;
  blockedByEmail?: string | null;
  [key: string]: unknown;
};

type ReservationStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "completed";

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

        if (user.isBlocked === true) {
          return res.status(403).json({
            code: "USER_BLOCKED",
            message:
              "Your account has been blocked by an administrator.",
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

    const normalizeAccountType = (
      value: unknown,
    ) => {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
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
      const accountType = normalizeAccountType(
        user?.accountType,
      );

      if (
        user?.role === "admin" ||
        accountType === "restaurant_owner"
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
      const accountType = normalizeAccountType(
        user?.accountType,
      );

      if (
        user?.role === "admin" ||
        accountType !== "restaurant_owner"
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



    // =====================================================
    // ADMIN USER API
    // =====================================================

    const getUserIdFilter = (
      value: string,
    ): Filter<UserDocument> => {
      const possibleIds: Array<
        string | ObjectId
      > = [value];

      if (ObjectId.isValid(value)) {
        possibleIds.push(
          new ObjectId(value),
        );
      }

      return {
        $or: possibleIds.map((_id) => ({
          _id,
        })),
      };
    };

    const getSafeAdminUser = (
      user: UserDocument,
      currentAdminId: unknown,
    ) => {
      const accountType =
        normalizeAccountType(
          user.accountType,
        );

      return {
        _id: String(user._id),
        name: String(user.name || ""),
        email: String(user.email || ""),
        image: String(user.image || ""),
        emailVerified: Boolean(
          user.emailVerified,
        ),
        role:
          user.role === "admin"
            ? "admin"
            : "user",
        accountType:
          accountType ===
          "restaurant_owner"
            ? "restaurant_owner"
            : "customer",
        createdAt:
          user.createdAt || null,
        updatedAt:
          user.updatedAt || null,
        isBlocked:
          user.isBlocked === true,
        blockedAt:
          user.blockedAt || null,
        isCurrentUser:
          String(user._id) ===
          String(currentAdminId || ""),
      };
    };

    // Admin gets all registered users
    app.get(
      "/api/admin/users",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const search = String(
            req.query.search || "",
          ).trim();

          const role = String(
            req.query.role || "",
          ).toLowerCase();

          const accountType =
            normalizeAccountType(
              req.query.accountType,
            );

          const filters: Array<
            Filter<UserDocument>
          > = [];

          if (search) {
            const safeSearch =
              search.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
              );

            const searchRegex =
              new RegExp(safeSearch, "i");

            filters.push({
              $or: [
                {
                  name: searchRegex,
                },
                {
                  email: searchRegex,
                },
              ],
            });
          }

          if (role === "admin") {
            filters.push({
              role: "admin",
            });
          }

          if (role === "user") {
            filters.push({
              $or: [
                {
                  role: "user",
                },
                {
                  role: {
                    $exists: false,
                  },
                },
                {
                  role: null,
                },
              ],
            });
          }

          if (
            accountType ===
            "restaurant_owner"
          ) {
            filters.push({
              accountType:
                "restaurant_owner",
            });
          }

          if (
            accountType === "customer"
          ) {
            filters.push({
              $or: [
                {
                  accountType:
                    "customer",
                },
                {
                  accountType: {
                    $exists: false,
                  },
                },
                {
                  accountType: null,
                },
              ],
            });
          }

          const query: Filter<UserDocument> =
            filters.length > 0
              ? {
                  $and: filters,
                }
              : {};

          const users =
            await userCollection
              .find(query, {
                projection: {
                  name: 1,
                  email: 1,
                  image: 1,
                  emailVerified: 1,
                  role: 1,
                  accountType: 1,
                  createdAt: 1,
                  updatedAt: 1,
                  isBlocked: 1,
                  blockedAt: 1,
                },
              })
              .sort({
                createdAt: -1,
              })
              .toArray();

          const admin = getAuthUser(req);

          res.json(
            users.map((user) =>
              getSafeAdminUser(
                user,
                admin?._id,
              ),
            ),
          );
        } catch (error) {
          console.error(
            "Admin users fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch users.",
          });
        }
      },
    );

    // Admin changes a user's application role
    app.patch(
      "/api/admin/users/:id/role",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const userId = String(
            req.params.id || "",
          ).trim();

          if (!userId) {
            return res.status(400).json({
              message:
                "A valid user ID is required.",
            });
          }

          const requestedRole = String(
            req.body?.role || "",
          ).toLowerCase();

          if (
            !["user", "admin"].includes(
              requestedRole,
            )
          ) {
            return res.status(400).json({
              message:
                "Role must be user or admin.",
            });
          }

          const targetUser =
            await userCollection.findOne(
              getUserIdFilter(userId),
            );

          if (!targetUser) {
            return res.status(404).json({
              message:
                "User was not found.",
            });
          }

          const admin = getAuthUser(req);

          if (
            String(targetUser._id) ===
            String(admin?._id || "")
          ) {
            return res.status(409).json({
              message:
                "You cannot change your own admin role.",
            });
          }

          await userCollection.updateOne(
            {
              _id: targetUser._id,
            },
            {
              $set: {
                role: requestedRole,
                updatedAt: new Date(),
              },
            },
          );

          const updatedUser =
            await userCollection.findOne({
              _id: targetUser._id,
            });

          if (!updatedUser) {
            return res.status(404).json({
              message:
                "Updated user was not found.",
            });
          }

          res.json({
            success: true,
            message: `User role changed to ${requestedRole}.`,
            user: getSafeAdminUser(
              updatedUser,
              admin?._id,
            ),
          });
        } catch (error) {
          console.error(
            "Admin user role update error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to update user role.",
          });
        }
      },
    );

    // Admin changes a normal user's account type
    app.patch(
      "/api/admin/users/:id/account-type",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const userId = String(
            req.params.id || "",
          ).trim();

          if (!userId) {
            return res.status(400).json({
              message:
                "A valid user ID is required.",
            });
          }

          const requestedAccountType =
            normalizeAccountType(
              req.body?.accountType,
            );

          if (
            ![
              "customer",
              "restaurant_owner",
            ].includes(
              requestedAccountType,
            )
          ) {
            return res.status(400).json({
              message:
                "Account type must be customer or restaurant_owner.",
            });
          }

          const targetUser =
            await userCollection.findOne(
              getUserIdFilter(userId),
            );

          if (!targetUser) {
            return res.status(404).json({
              message:
                "User was not found.",
            });
          }

          if (targetUser.role === "admin") {
            return res.status(409).json({
              message:
                "Admin account type cannot be changed.",
            });
          }

          const currentAccountType =
            normalizeAccountType(
              targetUser.accountType,
            );

          if (
            currentAccountType ===
              "restaurant_owner" &&
            requestedAccountType ===
              "customer"
          ) {
            const ownerFilters: Array<
              Record<string, string>
            > = [
              {
                ownerId: String(
                  targetUser._id,
                ),
              },
            ];

            if (targetUser.email) {
              ownerFilters.push({
                ownerEmail: String(
                  targetUser.email,
                ),
              });
            }

            const ownedRestaurant =
              await restaurantCollection.findOne({
                $or: ownerFilters,
              });

            if (ownedRestaurant) {
              return res.status(409).json({
                message:
                  "This owner still has a restaurant. Delete the restaurant before changing the account to customer.",
              });
            }
          }

          await userCollection.updateOne(
            {
              _id: targetUser._id,
            },
            {
              $set: {
                accountType:
                  requestedAccountType,
                updatedAt: new Date(),
              },
            },
          );

          const updatedUser =
            await userCollection.findOne({
              _id: targetUser._id,
            });

          if (!updatedUser) {
            return res.status(404).json({
              message:
                "Updated user was not found.",
            });
          }

          const admin = getAuthUser(req);

          res.json({
            success: true,
            message:
              requestedAccountType ===
              "restaurant_owner"
                ? "Account changed to restaurant owner."
                : "Account changed to customer.",
            user: getSafeAdminUser(
              updatedUser,
              admin?._id,
            ),
          });
        } catch (error) {
          console.error(
            "Admin account type update error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to update account type.",
          });
        }
      },
    );


    // Admin blocks or unblocks a user
    app.patch(
      "/api/admin/users/:id/block",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const userId = String(
            req.params.id || "",
          ).trim();

          if (!userId) {
            return res.status(400).json({
              message:
                "A valid user ID is required.",
            });
          }

          if (
            typeof req.body?.isBlocked !==
            "boolean"
          ) {
            return res.status(400).json({
              message:
                "isBlocked must be true or false.",
            });
          }

          const targetUser =
            await userCollection.findOne(
              getUserIdFilter(userId),
            );

          if (!targetUser) {
            return res.status(404).json({
              message:
                "User was not found.",
            });
          }

          const admin = getAuthUser(req);

          if (
            String(targetUser._id) ===
            String(admin?._id || "")
          ) {
            return res.status(409).json({
              message:
                "You cannot block your own account.",
            });
          }

          const isBlocked =
            req.body.isBlocked;
          const now = new Date();

          await userCollection.updateOne(
            {
              _id: targetUser._id,
            },
            {
              $set: {
                isBlocked,
                blockedAt: isBlocked
                  ? now
                  : null,
                blockedBy: isBlocked
                  ? String(
                      admin?._id || "",
                    )
                  : null,
                blockedByEmail: isBlocked
                  ? String(
                      admin?.email || "",
                    )
                  : null,
                updatedAt: now,
              },
            },
          );

          const updatedUser =
            await userCollection.findOne({
              _id: targetUser._id,
            });

          if (!updatedUser) {
            return res.status(404).json({
              message:
                "Updated user was not found.",
            });
          }

          res.json({
            success: true,
            message: isBlocked
              ? "User blocked successfully."
              : "User unblocked successfully.",
            user: getSafeAdminUser(
              updatedUser,
              admin?._id,
            ),
          });
        } catch (error) {
          console.error(
            "Admin user block update error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to update user access.",
          });
        }
      },
    );

    // =====================================================
    // RESERVATION API
    // =====================================================

    const reservationStatuses: ReservationStatus[] = [
      "pending",
      "confirmed",
      "rejected",
      "cancelled",
      "completed",
    ];

    const ownerReservationStatuses: ReservationStatus[] = [
      "confirmed",
      "rejected",
      "completed",
    ];

    const getCustomerReservationFilter = (
      user: AuthenticatedRequest["user"],
    ) => ({
      $or: [
        {
          customerId: String(user?._id || ""),
        },
        {
          customerEmail: String(user?.email || ""),
        },
      ],
    });

    const getReservationDateTime = (
      reservationDate: string,
      reservationTime: string,
    ) => {
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const timePattern =
        /^([01]\d|2[0-3]):[0-5]\d$/;

      if (
        !datePattern.test(reservationDate) ||
        !timePattern.test(reservationTime)
      ) {
        return null;
      }

      const dateTime = new Date(
        `${reservationDate}T${reservationTime}:00`,
      );

      if (Number.isNaN(dateTime.getTime())) {
        return null;
      }

      return dateTime;
    };

    // Customer creates a reservation
    app.post(
      "/api/reservations",
      verifyToken,
      verifyCustomer,
      async (req, res) => {
        try {
          const user = getAuthUser(req);
          const reservationData =
            req.body || {};

          const restaurantId = getObjectId(
            String(
              reservationData.restaurantId ||
                "",
            ),
          );

          if (!restaurantId) {
            return res.status(400).json({
              message:
                "A valid restaurant ID is required.",
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
                "Approved restaurant was not found.",
            });
          }

          const reservationDate = String(
            reservationData.reservationDate ||
              reservationData.date ||
              "",
          ).trim();

          const reservationTime = String(
            reservationData.reservationTime ||
              reservationData.time ||
              "",
          ).trim();

          const reservationDateTime =
            getReservationDateTime(
              reservationDate,
              reservationTime,
            );

          if (
            !reservationDateTime ||
            reservationDateTime.getTime() <=
              Date.now()
          ) {
            return res.status(400).json({
              message:
                "Reservation date and time must be in the future.",
            });
          }

          const guestCount = Number(
            reservationData.guestCount ??
              reservationData.guests,
          );

          if (
            !Number.isInteger(guestCount) ||
            guestCount < 1 ||
            guestCount > 20
          ) {
            return res.status(400).json({
              message:
                "Guest count must be between 1 and 20.",
            });
          }

          const phone = String(
            reservationData.phone || "",
          ).trim();

          if (!phone) {
            return res.status(400).json({
              message:
                "A contact phone number is required.",
            });
          }

          const customerId = String(
            user?._id || "",
          );

          const customerEmail = String(
            user?.email || "",
          );

          const duplicateReservation =
            await reservationCollection.findOne({
              restaurantId:
                restaurant._id.toString(),
              reservationDate,
              reservationTime,
              status: {
                $in: [
                  "pending",
                  "confirmed",
                ],
              },
              $or: [
                {
                  customerId,
                },
                {
                  customerEmail,
                },
              ],
            });

          if (duplicateReservation) {
            return res.status(409).json({
              message:
                "You already have an active reservation for this restaurant at the selected date and time.",
            });
          }

          const now = new Date();

          const newReservation = {
            restaurantId:
              restaurant._id.toString(),
            restaurantName: String(
              restaurant.name || "",
            ),
            restaurantImage: String(
              restaurant.image || "",
            ),
            restaurantLocation: String(
              restaurant.location || "",
            ),
            restaurantOwnerId: String(
              restaurant.ownerId || "",
            ),
            restaurantOwnerEmail: String(
              restaurant.ownerEmail || "",
            ),

            customerId,
            customerName: String(
              user?.name || "",
            ),
            customerEmail,

            phone,
            reservationDate,
            reservationTime,
            guestCount,
            specialRequest: String(
              reservationData.specialRequest ||
                "",
            ).trim(),

            status: "pending",
            statusHistory: [
              {
                status: "pending",
                changedAt: now,
                changedBy: customerId,
                changedByEmail:
                  customerEmail,
                changedByRole: "customer",
              },
            ],

            createdAt: now,
            updatedAt: now,
          };

          const result =
            await reservationCollection.insertOne(
              newReservation,
            );

          res.status(201).json({
            success: true,
            message:
              "Reservation submitted successfully.",
            insertedId: result.insertedId,
            reservation: {
              ...newReservation,
              _id: result.insertedId,
            },
          });
        } catch (error) {
          console.error(
            "Reservation create error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to create reservation.",
          });
        }
      },
    );

    // Customer gets their own reservations
    app.get(
      "/api/my/reservations",
      verifyToken,
      verifyCustomer,
      async (req, res) => {
        try {
          const user = getAuthUser(req);
          const status = String(
            req.query.status || "",
          ).toLowerCase();

          const query: Record<
            string,
            unknown
          > = {
            ...getCustomerReservationFilter(
              user,
            ),
          };

          if (
            reservationStatuses.includes(
              status as ReservationStatus,
            )
          ) {
            query.status = status;
          }

          const reservations =
            await reservationCollection
              .find(query)
              .sort({
                reservationDate: -1,
                reservationTime: -1,
                createdAt: -1,
              })
              .toArray();

          res.json(reservations);
        } catch (error) {
          console.error(
            "Customer reservations fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch your reservations.",
          });
        }
      },
    );

    // Customer cancels their own active reservation
    app.patch(
      "/api/reservations/:id/cancel",
      verifyToken,
      verifyCustomer,
      async (req, res) => {
        try {
          const reservationId = getObjectId(
            req.params.id,
          );

          if (!reservationId) {
            return res.status(400).json({
              message:
                "Invalid reservation ID.",
            });
          }

          const user = getAuthUser(req);

          const reservation =
            await reservationCollection.findOne({
              _id: reservationId,
              ...getCustomerReservationFilter(
                user,
              ),
            });

          if (!reservation) {
            return res.status(404).json({
              message:
                "Reservation was not found.",
            });
          }

          if (
            ![
              "pending",
              "confirmed",
            ].includes(
              String(
                reservation.status || "",
              ),
            )
          ) {
            return res.status(409).json({
              message:
                "This reservation can no longer be cancelled.",
            });
          }

          const now = new Date();

          const statusHistory =
            Array.isArray(
              reservation.statusHistory,
            )
              ? reservation.statusHistory
              : [];

          await reservationCollection.updateOne(
            {
              _id: reservationId,
            },
            {
              $set: {
                status: "cancelled",
                cancelledAt: now,
                cancelledBy: String(
                  user?._id || "",
                ),
                updatedAt: now,
                statusHistory: [
                  ...statusHistory,
                  {
                    status: "cancelled",
                    changedAt: now,
                    changedBy: String(
                      user?._id || "",
                    ),
                    changedByEmail: String(
                      user?.email || "",
                    ),
                    changedByRole:
                      "customer",
                  },
                ],
              },
            },
          );

          const updatedReservation =
            await reservationCollection.findOne({
              _id: reservationId,
            });

          res.json({
            success: true,
            message:
              "Reservation cancelled successfully.",
            reservation:
              updatedReservation,
          });
        } catch (error) {
          console.error(
            "Reservation cancel error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to cancel reservation.",
          });
        }
      },
    );

    // Restaurant owner gets reservations for their restaurant
    app.get(
      "/api/owner/reservations",
      verifyToken,
      verifyRestaurantOwner,
      async (req, res) => {
        try {
          const user = getAuthUser(req);

          const restaurant =
            await restaurantCollection.findOne(
              getOwnerFilter(user),
            );

          if (!restaurant) {
            return res.json([]);
          }

          const status = String(
            req.query.status || "",
          ).toLowerCase();

          const search = String(
            req.query.search || "",
          ).trim();

          const query: Record<
            string,
            unknown
          > = {
            restaurantId:
              restaurant._id.toString(),
          };

          if (
            reservationStatuses.includes(
              status as ReservationStatus,
            )
          ) {
            query.status = status;
          }

          if (search) {
            const safeSearch =
              search.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
              );

            const searchRegex =
              new RegExp(safeSearch, "i");

            query.$or = [
              {
                customerName:
                  searchRegex,
              },
              {
                customerEmail:
                  searchRegex,
              },
              {
                phone: searchRegex,
              },
            ];
          }

          const reservations =
            await reservationCollection
              .find(query)
              .sort({
                reservationDate: 1,
                reservationTime: 1,
                createdAt: -1,
              })
              .toArray();

          res.json(reservations);
        } catch (error) {
          console.error(
            "Owner reservations fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch restaurant reservations.",
          });
        }
      },
    );

    // Restaurant owner updates reservation status
    app.patch(
      "/api/owner/reservations/:id/status",
      verifyToken,
      verifyRestaurantOwner,
      async (req, res) => {
        try {
          const reservationId = getObjectId(
            req.params.id,
          );

          if (!reservationId) {
            return res.status(400).json({
              message:
                "Invalid reservation ID.",
            });
          }

          const requestedStatus = String(
            req.body?.status || "",
          ).toLowerCase() as ReservationStatus;

          if (
            !ownerReservationStatuses.includes(
              requestedStatus,
            )
          ) {
            return res.status(400).json({
              message:
                "Invalid reservation status.",
              allowedStatuses:
                ownerReservationStatuses,
            });
          }

          const user = getAuthUser(req);

          const restaurant =
            await restaurantCollection.findOne(
              getOwnerFilter(user),
            );

          if (!restaurant) {
            return res.status(404).json({
              message:
                "Restaurant was not found.",
            });
          }

          const reservation =
            await reservationCollection.findOne({
              _id: reservationId,
              restaurantId:
                restaurant._id.toString(),
            });

          if (!reservation) {
            return res.status(404).json({
              message:
                "Reservation was not found or you cannot manage it.",
            });
          }

          const currentStatus = String(
            reservation.status || "",
          );

          if (
            [
              "cancelled",
              "rejected",
              "completed",
            ].includes(currentStatus)
          ) {
            return res.status(409).json({
              message:
                "A finalized reservation cannot be changed.",
            });
          }

          if (
            requestedStatus ===
              "completed" &&
            currentStatus !==
              "confirmed"
          ) {
            return res.status(409).json({
              message:
                "Only a confirmed reservation can be marked as completed.",
            });
          }

          const now = new Date();

          const updateData: Record<
            string,
            unknown
          > = {
            status: requestedStatus,
            updatedAt: now,
          };

          if (
            requestedStatus ===
            "confirmed"
          ) {
            updateData.confirmedAt = now;
            updateData.confirmedBy =
              String(user?._id || "");
          }

          if (
            requestedStatus ===
            "rejected"
          ) {
            updateData.rejectedAt = now;
            updateData.rejectedBy =
              String(user?._id || "");
          }

          if (
            requestedStatus ===
            "completed"
          ) {
            updateData.completedAt = now;
            updateData.completedBy =
              String(user?._id || "");
          }

          const statusHistory =
            Array.isArray(
              reservation.statusHistory,
            )
              ? reservation.statusHistory
              : [];

          updateData.statusHistory = [
            ...statusHistory,
            {
              status: requestedStatus,
              changedAt: now,
              changedBy: String(
                user?._id || "",
              ),
              changedByEmail: String(
                user?.email || "",
              ),
              changedByRole:
                "restaurant_owner",
            },
          ];

          await reservationCollection.updateOne(
            {
              _id: reservationId,
            },
            {
              $set: updateData,
            },
          );

          const updatedReservation =
            await reservationCollection.findOne({
              _id: reservationId,
            });

          res.json({
            success: true,
            message: `Reservation status changed to ${requestedStatus}.`,
            reservation:
              updatedReservation,
          });
        } catch (error) {
          console.error(
            "Owner reservation update error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to update reservation status.",
          });
        }
      },
    );

    // Admin gets all reservations
    app.get(
      "/api/admin/reservations",
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
            reservationStatuses.includes(
              status as ReservationStatus,
            )
          ) {
            query.status = status;
          }

          if (search) {
            const safeSearch =
              search.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
              );

            const searchRegex =
              new RegExp(safeSearch, "i");

            query.$or = [
              {
                restaurantName:
                  searchRegex,
              },
              {
                customerName:
                  searchRegex,
              },
              {
                customerEmail:
                  searchRegex,
              },
              {
                phone: searchRegex,
              },
            ];
          }

          const reservations =
            await reservationCollection
              .find(query)
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(reservations);
        } catch (error) {
          console.error(
            "Admin reservations fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch reservations.",
          });
        }
      },
    );

    // Admin deletes any reservation
    app.delete(
      "/api/admin/reservations/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const reservationId = getObjectId(
            req.params.id,
          );

          if (!reservationId) {
            return res.status(400).json({
              message:
                "Invalid reservation ID.",
            });
          }

          const result =
            await reservationCollection.deleteOne({
              _id: reservationId,
            });

          if (!result.deletedCount) {
            return res.status(404).json({
              message:
                "Reservation was not found.",
            });
          }

          res.json({
            success: true,
            message:
              "Reservation deleted successfully.",
          });
        } catch (error) {
          console.error(
            "Admin reservation delete error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to delete reservation.",
          });
        }
      },
    );


    // =====================================================
    // REVIEW AND RATING API
    // =====================================================

    const updateRestaurantRating = async (
      restaurantId: ObjectId,
    ) => {
      const restaurantIdText =
        restaurantId.toString();

      const [ratingSummary] =
        await reviewCollection
          .aggregate<{
            averageRating: number;
            reviewCount: number;
          }>([
            {
              $match: {
                restaurantId:
                  restaurantIdText,
              },
            },
            {
              $group: {
                _id: null,
                averageRating: {
                  $avg: "$rating",
                },
                reviewCount: {
                  $sum: 1,
                },
              },
            },
          ])
          .toArray();

      const averageRating = ratingSummary
        ? Number(
            ratingSummary.averageRating.toFixed(
              1,
            ),
          )
        : 0;

      const reviewCount =
        ratingSummary?.reviewCount || 0;

      await restaurantCollection.updateOne(
        {
          _id: restaurantId,
        },
        {
          $set: {
            averageRating,
            reviewCount,
            updatedAt: new Date(),
          },
        },
      );

      return {
        averageRating,
        reviewCount,
      };
    };

    const getCustomerReviewFilter = (
      user: AuthenticatedRequest["user"],
    ) => ({
      $or: [
        {
          customerId: String(
            user?._id || "",
          ),
        },
        {
          customerEmail: String(
            user?.email || "",
          ),
        },
      ],
    });

    // Customer creates one review from one completed reservation
    app.post(
      "/api/reviews",
      verifyToken,
      verifyCustomer,
      async (req, res) => {
        try {
          const user = getAuthUser(req);
          const reviewData = req.body || {};

          const reservationId = getObjectId(
            String(
              reviewData.reservationId ||
                "",
            ),
          );

          if (!reservationId) {
            return res.status(400).json({
              message:
                "A valid reservation ID is required.",
            });
          }

          const reservation =
            await reservationCollection.findOne({
              _id: reservationId,
              status: "completed",
              ...getCustomerReservationFilter(
                user,
              ),
            });

          if (!reservation) {
            return res.status(403).json({
              message:
                "Only a completed reservation belonging to you can be reviewed.",
            });
          }

          const restaurantId = getObjectId(
            String(
              reservation.restaurantId ||
                "",
            ),
          );

          if (!restaurantId) {
            return res.status(400).json({
              message:
                "The reservation has an invalid restaurant ID.",
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
                "Approved restaurant was not found.",
            });
          }

          const existingReview =
            await reviewCollection.findOne({
              reservationId:
                reservationId.toString(),
            });

          if (existingReview) {
            return res.status(409).json({
              message:
                "You already reviewed this reservation.",
            });
          }

          const rating = Number(
            reviewData.rating,
          );

          if (
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 5
          ) {
            return res.status(400).json({
              message:
                "Rating must be a whole number between 1 and 5.",
            });
          }

          const comment = String(
            reviewData.comment || "",
          ).trim();

          if (!comment) {
            return res.status(400).json({
              message:
                "Review comment is required.",
            });
          }

          if (comment.length > 1000) {
            return res.status(400).json({
              message:
                "Review comment cannot exceed 1000 characters.",
            });
          }

          const now = new Date();

          const newReview = {
            reservationId:
              reservationId.toString(),

            restaurantId:
              restaurant._id.toString(),
            restaurantName: String(
              restaurant.name || "",
            ),
            restaurantImage: String(
              restaurant.image || "",
            ),

            customerId: String(
              user?._id || "",
            ),
            customerName: String(
              user?.name || "",
            ),
            customerEmail: String(
              user?.email || "",
            ),

            rating,
            comment,

            createdAt: now,
            updatedAt: now,
          };

          const result =
            await reviewCollection.insertOne(
              newReview,
            );

          const ratingSummary =
            await updateRestaurantRating(
              restaurant._id,
            );

          res.status(201).json({
            success: true,
            message:
              "Review submitted successfully.",
            insertedId: result.insertedId,
            review: {
              ...newReview,
              _id: result.insertedId,
            },
            ratingSummary,
          });
        } catch (error) {
          console.error(
            "Review create error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to submit review.",
          });
        }
      },
    );

    // Public reviews for one approved restaurant
    app.get(
      "/api/restaurants/:id/reviews",
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

          const reviews =
            await reviewCollection
              .find({
                restaurantId:
                  restaurantId.toString(),
              })
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json({
            reviews,
            summary: {
              averageRating: Number(
                restaurant.averageRating || 0,
              ),
              reviewCount: Number(
                restaurant.reviewCount || 0,
              ),
            },
          });
        } catch (error) {
          console.error(
            "Restaurant reviews fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch restaurant reviews.",
          });
        }
      },
    );

    // Customer gets their own reviews
    app.get(
      "/api/my/reviews",
      verifyToken,
      verifyCustomer,
      async (req, res) => {
        try {
          const user = getAuthUser(req);

          const reviews =
            await reviewCollection
              .find(
                getCustomerReviewFilter(
                  user,
                ),
              )
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(reviews);
        } catch (error) {
          console.error(
            "Customer reviews fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch your reviews.",
          });
        }
      },
    );

    // Customer updates their own review
    app.patch(
      "/api/reviews/:id",
      verifyToken,
      verifyCustomer,
      async (req, res) => {
        try {
          const reviewId = getObjectId(
            req.params.id,
          );

          if (!reviewId) {
            return res.status(400).json({
              message:
                "Invalid review ID.",
            });
          }

          const user = getAuthUser(req);

          const review =
            await reviewCollection.findOne({
              _id: reviewId,
              ...getCustomerReviewFilter(
                user,
              ),
            });

          if (!review) {
            return res.status(404).json({
              message:
                "Review was not found or you cannot update it.",
            });
          }

          const updateData: Record<
            string,
            unknown
          > = {};

          if (
            req.body?.rating !== undefined
          ) {
            const rating = Number(
              req.body.rating,
            );

            if (
              !Number.isInteger(rating) ||
              rating < 1 ||
              rating > 5
            ) {
              return res.status(400).json({
                message:
                  "Rating must be a whole number between 1 and 5.",
              });
            }

            updateData.rating = rating;
          }

          if (
            req.body?.comment !== undefined
          ) {
            const comment = String(
              req.body.comment,
            ).trim();

            if (!comment) {
              return res.status(400).json({
                message:
                  "Review comment cannot be empty.",
              });
            }

            if (comment.length > 1000) {
              return res.status(400).json({
                message:
                  "Review comment cannot exceed 1000 characters.",
              });
            }

            updateData.comment = comment;
          }

          if (
            Object.keys(updateData).length ===
            0
          ) {
            return res.status(400).json({
              message:
                "No review information was provided.",
            });
          }

          updateData.updatedAt =
            new Date();

          await reviewCollection.updateOne(
            {
              _id: reviewId,
              ...getCustomerReviewFilter(
                user,
              ),
            },
            {
              $set: updateData,
            },
          );

          const updatedReview =
            await reviewCollection.findOne({
              _id: reviewId,
            });

          const restaurantId =
            getObjectId(
              String(
                review.restaurantId || "",
              ),
            );

          const ratingSummary =
            restaurantId
              ? await updateRestaurantRating(
                  restaurantId,
                )
              : null;

          res.json({
            success: true,
            message:
              "Review updated successfully.",
            review: updatedReview,
            ratingSummary,
          });
        } catch (error) {
          console.error(
            "Review update error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to update review.",
          });
        }
      },
    );

    // Customer deletes their own review
    app.delete(
      "/api/reviews/:id",
      verifyToken,
      verifyCustomer,
      async (req, res) => {
        try {
          const reviewId = getObjectId(
            req.params.id,
          );

          if (!reviewId) {
            return res.status(400).json({
              message:
                "Invalid review ID.",
            });
          }

          const user = getAuthUser(req);

          const review =
            await reviewCollection.findOne({
              _id: reviewId,
              ...getCustomerReviewFilter(
                user,
              ),
            });

          if (!review) {
            return res.status(404).json({
              message:
                "Review was not found or you cannot delete it.",
            });
          }

          await reviewCollection.deleteOne({
            _id: reviewId,
            ...getCustomerReviewFilter(
              user,
            ),
          });

          const restaurantId =
            getObjectId(
              String(
                review.restaurantId || "",
              ),
            );

          const ratingSummary =
            restaurantId
              ? await updateRestaurantRating(
                  restaurantId,
                )
              : null;

          res.json({
            success: true,
            message:
              "Review deleted successfully.",
            ratingSummary,
          });
        } catch (error) {
          console.error(
            "Review delete error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to delete review.",
          });
        }
      },
    );

    // Restaurant owner gets reviews for their restaurant
    app.get(
      "/api/owner/reviews",
      verifyToken,
      verifyRestaurantOwner,
      async (req, res) => {
        try {
          const user = getAuthUser(req);

          const restaurant =
            await restaurantCollection.findOne(
              getOwnerFilter(user),
            );

          if (!restaurant) {
            return res.json({
              reviews: [],
              summary: {
                averageRating: 0,
                reviewCount: 0,
              },
            });
          }

          const search = String(
            req.query.search || "",
          ).trim();

          const query: Record<
            string,
            unknown
          > = {
            restaurantId:
              restaurant._id.toString(),
          };

          if (search) {
            const safeSearch =
              search.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
              );

            const searchRegex =
              new RegExp(safeSearch, "i");

            query.$or = [
              {
                customerName:
                  searchRegex,
              },
              {
                customerEmail:
                  searchRegex,
              },
              {
                comment: searchRegex,
              },
            ];
          }

          const reviews =
            await reviewCollection
              .find(query)
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json({
            reviews,
            summary: {
              averageRating: Number(
                restaurant.averageRating || 0,
              ),
              reviewCount: Number(
                restaurant.reviewCount || 0,
              ),
            },
          });
        } catch (error) {
          console.error(
            "Owner reviews fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch restaurant reviews.",
          });
        }
      },
    );

    // Admin gets all reviews
    app.get(
      "/api/admin/reviews",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const search = String(
            req.query.search || "",
          ).trim();

          const requestedRating =
            Number(req.query.rating);

          const query: Record<
            string,
            unknown
          > = {};

          if (
            Number.isInteger(
              requestedRating,
            ) &&
            requestedRating >= 1 &&
            requestedRating <= 5
          ) {
            query.rating =
              requestedRating;
          }

          if (search) {
            const safeSearch =
              search.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
              );

            const searchRegex =
              new RegExp(safeSearch, "i");

            query.$or = [
              {
                restaurantName:
                  searchRegex,
              },
              {
                customerName:
                  searchRegex,
              },
              {
                customerEmail:
                  searchRegex,
              },
              {
                comment: searchRegex,
              },
            ];
          }

          const reviews =
            await reviewCollection
              .find(query)
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(reviews);
        } catch (error) {
          console.error(
            "Admin reviews fetch error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to fetch reviews.",
          });
        }
      },
    );

    // Admin deletes any review
    app.delete(
      "/api/admin/reviews/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const reviewId = getObjectId(
            req.params.id,
          );

          if (!reviewId) {
            return res.status(400).json({
              message:
                "Invalid review ID.",
            });
          }

          const review =
            await reviewCollection.findOne({
              _id: reviewId,
            });

          if (!review) {
            return res.status(404).json({
              message:
                "Review was not found.",
            });
          }

          await reviewCollection.deleteOne({
            _id: reviewId,
          });

          const restaurantId =
            getObjectId(
              String(
                review.restaurantId || "",
              ),
            );

          const ratingSummary =
            restaurantId
              ? await updateRestaurantRating(
                  restaurantId,
                )
              : null;

          res.json({
            success: true,
            message:
              "Review deleted successfully.",
            ratingSummary,
          });
        } catch (error) {
          console.error(
            "Admin review delete error:",
            error,
          );

          res.status(500).json({
            message:
              "Failed to delete review.",
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