import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StudioFlow Instructor",
    short_name: "StudioFlow",
    description: "Pilates class schedule and instructor notifications.",
    start_url: "/instructor",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#ffffff",
  };
}
