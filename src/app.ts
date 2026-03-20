import express, { type Express } from "express";
import cors from "cors";
import silocargoRouter from "./routes/silocargo";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "silocargo-webservice-tms" });
});

app.use("/api", silocargoRouter);

export default app;
