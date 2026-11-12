import type { Metadata } from "next";
import RecoveryCentre from "./recovery-centre";

export const metadata: Metadata = { title: "Recovery Centre" };

export default function RecoveryPage() {
  return <RecoveryCentre />;
}
