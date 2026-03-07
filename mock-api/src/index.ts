import express from "express";
import kycRouter from "./routes/kyc";
import sanctionsRouter from "./routes/sanctions";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(express.json());

// Routes
app.use("/kyc", kycRouter);
app.use("/sanctions", sanctionsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    provider: "mock-kyc-v1",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Mock KYC API running on port ${PORT}`);
});

export default app;
