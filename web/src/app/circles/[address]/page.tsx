import type { Metadata } from "next";
import { Suspense } from "react";

import { CircleDetail } from "@/components/circles/circle-detail";

export const metadata: Metadata = { title: "Circle" };

export default async function CirclePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <Suspense>
      <CircleDetail address={address} />
    </Suspense>
  );
}
