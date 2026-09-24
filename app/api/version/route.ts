import { BUILD_ID, BUILT_AT } from "@/lib/build-info";

export const dynamic = "force-dynamic";

/** The build the server is running. The app compares it with its own. */
export function GET() {
  return Response.json({ build: BUILD_ID, builtAt: BUILT_AT }, { headers: { "Cache-Control": "no-store" } });
}
