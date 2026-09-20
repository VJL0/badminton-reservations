import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Badminton Queue",
    short_name: "Badminton",
    description: "Join the open-play queue and see when your court is ready.",
    start_url: "/",
    display: "standalone",
    background_color: "#e9eeea",
    theme_color: "#e9eeea",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
