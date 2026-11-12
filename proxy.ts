import { NextResponse, type NextRequest } from "next/server";
import { isValidRecoveryAuthorization } from "@/lib/recovery-auth";

export function proxy(request: NextRequest) {
  if (!process.env.RECOVERY_CENTRE_USERNAME || !process.env.RECOVERY_CENTRE_PASSWORD) {
    return new NextResponse("Recovery Centre access is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!isValidRecoveryAuthorization(request.headers.get("authorization"))) {
    return new NextResponse("Merchant sign-in is required.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="RescueCart Recovery Centre", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/recovery/:path*", "/api/recovery/:path*"],
};
