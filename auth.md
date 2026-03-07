The 30 Rules of Secure Vibe Coding
Context: These rules must be applied to every MVP and production app. Security is a foundation, not a post-launch feature.

1. Authentication & Sessions
Rule 1: Set Session Expiration. JWT tokens max out at 7 days. Implement refresh token rotation.

Rule 2: Never Use AI-Built Auth. Do not let the AI write custom auth logic. Use Clerk, Supabase Auth, or Auth0.

2. Secrets & Environment
Rule 3: No API Keys in Chat. Never paste raw keys into Cursor/AI prompts. Use process.env.

Rule 4: .gitignore First. This is the first file created and committed. No exceptions.

Rule 5: Rotate Secrets. Rotate all production keys every 90 days.

3. Packages & Dependencies
Rule 6: Verify Every Package. Check npm download counts and last publish dates. Watch for typosquatting.

Rule 7: Force Latest Versions. Explicitly ask for the most recent stable version; don't let the AI default to its training cutoff.

Rule 8: Continuous Audit. Run npm audit fix immediately after building, not just before shipping.

4. Input & Data Security
Rule 9: Sanitize Everything. Sanitize forms, query params, and uploads. Use parameterized queries to prevent SQL injection.

Rule 10: Row-Level Security (RLS). Enable RLS from Day 1 (especially on Supabase) for data isolation.

5. Code Hygiene
Rule 11: Scrub Console Logs. Remove all console.log statements before deployment to prevent internal logic leaks.

Rule 12: Strict CORS. Never use wildcards (*). Only allow specific production domains.

Rule 13: Validate Redirects. Maintain an allow-list for URLs to prevent open redirect attacks.

6. API & Rate Limiting
Rule 14: Universal Limits. Apply auth and rate limits to all endpoints (Web and Mobile).

Rule 15: Default Rate Limit. Start with a baseline of 100 requests/hour per IP.

Rule 16: Strict Reset Limits. Password reset routes: Max 3 attempts per email per hour.

7. Cost & Infrastructure
Rule 17: Double-Layer Cost Caps. Set spend limits in the provider dashboard and hard-coded logic checks.

Rule 18: DDoS Protection. Use Cloudflare or Vercel Edge config immediately.

8. Storage & Files
Rule 19: Locked Buckets. Ensure users can only access their specific folder/files, never public or shared buckets.

Rule 20: Magic Byte Validation. Validate file types by signature/buffer, not just the extension. Limit upload sizes.

9. Payments & Email
Rule 21: Webhook Verification. Always verify signatures (Stripe/Lemon Squeezy) before processing payment events.

Rule 22: Deliverability Basics. Use Resend/SendGrid with proper SPF and DKIM records.

10. Permissions & Logging
Rule 23: Server-Side Authority. UI checks are UX only. All permissions must be enforced on the server.

Rule 24: AI Security Persona. Periodically ask the AI: "Act as a security engineer. Review this code for vulnerabilities."

Rule 25: AI Red Teaming. Ask the AI: "Try to find a way to hack or bypass this specific flow."

Rule 26: Audit Trails. Log critical actions (deletions, role changes, exports) to avoid "investigating blind."

11. Compliance & Environments
Rule 27: Account Deletion. Build a GDPR-compliant deletion flow before launch.

Rule 28: Tested Backups. An untested backup is a myth. Test restoration weekly.

Rule 29: Total Environment Isolation. Separate DBs and API keys for Test vs. Production.

Rule 30: No Cross-Pollination. Never let test webhooks/sandboxes point to real production systems.