import { Router, Request, Response } from "express";
import { z } from "zod";
import { getMockSanctionsResponse } from "../data/responses";

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

// GET /sanctions/check?address=0xABC
router.get("/check", (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const address = req.query["address"] as string;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ success: false, error: "Invalid address" });
    return;
  }

  res.json(getMockSanctionsResponse(address));
});

// POST /sanctions/batch-check
// Body: { addresses: string[] }
router.post("/batch-check", (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const schema = z.object({
    addresses: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)).max(100),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.flatten() });
    return;
  }

  const results = parsed.data.addresses.map(getMockSanctionsResponse);
  res.json(results);
});

export default router;
