import { Router, Request, Response } from "express";
import { z } from "zod";
import { getMockKYCResponse } from "../data/responses";

const router = Router();

const BEARER_TOKEN = process.env.MOCK_API_BEARER_TOKEN ?? "mock-bearer-token-123";

function requireAuth(req: Request, res: Response): boolean {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${BEARER_TOKEN}`) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

const verifyBodySchema = z.object({
  address:      z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  jurisdiction: z.string().min(2).max(10),
  provider:     z.string().optional(),
});

// POST /kyc/verify
router.post("/verify", (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  // Simulate error for testing
  if (req.query["forceError"] === "true") {
    res.status(500).json({ success: false, error: "Upstream KYC provider timeout" });
    return;
  }

  const parsed = verifyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  const { address, jurisdiction } = parsed.data;
  const response = getMockKYCResponse(address, jurisdiction);

  res.json(response);
});

export default router;
