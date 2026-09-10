// @vitest-environment jsdom
/**
 * Phase 17 (G8) — MapView smoke test: without a configured Google Maps key
 * the component must fail fast into the honest "Map unavailable" fallback
 * instead of hanging on a spinner (and must never attempt a script injection).
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MapView } from "./Map";

describe("MapView", () => {
  it("renders the honest fallback when no maps API key is configured", async () => {
    render(<MapView />);
    await waitFor(() => {
      expect(screen.getByText("Map unavailable")).toBeTruthy();
    });
    // Fail-closed: no runtime CDN script was injected into the document
    expect(document.querySelector("script[src*='maps/api/js']")).toBeNull();
  });

  it("exposes an accessible map region while loading", () => {
    const { container } = render(<MapView />);
    expect(container.querySelector('[role="region"][aria-label="Interactive map"]')).toBeTruthy();
  });
});
