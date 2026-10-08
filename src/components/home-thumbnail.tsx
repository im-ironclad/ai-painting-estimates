"use client";

import { House } from "lucide-react";
import { useState } from "react";

/** Falls back to a placeholder when the photo fails to load, including a failure that lands before hydration. */
export function HomeThumbnail({ photoId }: { photoId: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!photoId || failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-plum-300" data-testid="home-thumbnail-placeholder">
        <House className="size-10" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the photo route already returns a sized thumbnail
    <img
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      onError={() => setFailed(true)}
      src={`/api/photos/${photoId}/image?size=thumb`}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute inset-0 size-full object-cover"
    />
  );
}
