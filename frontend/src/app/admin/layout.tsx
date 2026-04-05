import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";

export const metadata: Metadata = {
  title: "CareConnect Admin",
  description: "Master dashboard for CareConnect",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
