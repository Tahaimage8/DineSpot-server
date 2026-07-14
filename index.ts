import cors from "cors";
import dotenv from "dotenv";
import express, {
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

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error(
    "MONGODB_URI is missing in the .env file.",
  );
}

const client = new MongoClient(mongoUri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.use(
  cors({
    origin:
      process.env.CLIENT_URL ||
      "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json());

app.get(
  "/",
  (_req: Request, res: Response) => {
    res.send("DineSpot server is running.");
  },
);

async function run() {
  try {
    await client.connect();

    await client
      .db("admin")
      .command({ ping: 1 });

    console.log(
      "MongoDB connected successfully!",
    );

    app.listen(port, () => {
      console.log(
        `DineSpot server is running on port ${port}`,
      );
    });
  } catch (error) {
    console.error(
      "MongoDB connection failed:",
      error,
    );
  }
}

run();