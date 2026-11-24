import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../shell/ErrorBoundary";

function Boom(): never { throw new Error("kaboom"); }

describe("the error boundary", () => {
  it("shows a way back instead of an empty window when a screen throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this screen");
    expect(screen.getByRole("alert")).toHaveTextContent("kaboom");
    expect(screen.getByRole("button", { name: "Reload MotionCraft" })).toBeInTheDocument();
  });
  it("renders its children when nothing is wrong", () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeInTheDocument();
  });
});
