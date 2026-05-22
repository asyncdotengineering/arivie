/* SPDX-License-Identifier: Apache-2.0 */
import { clerkMiddleware } from "@clerk/nextjs/server";
import { assertAuthBypassAllowed } from "./lib/auth-bypass";

assertAuthBypassAllowed();

export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
