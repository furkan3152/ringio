import type { Metadata } from "next";

import { MyCircles } from "@/components/circles/my-circles";

export const metadata: Metadata = { title: "My circles" };

export default function CirclesPage() {
  return <MyCircles />;
}
