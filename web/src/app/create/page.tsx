import type { Metadata } from "next";

import { CreateCircle } from "@/components/create/create-circle";

export const metadata: Metadata = { title: "Start a circle" };

export default function CreatePage() {
  return <CreateCircle />;
}
