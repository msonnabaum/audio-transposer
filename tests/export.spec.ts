import { test, expect } from "@playwright/test";
import path from "path";

test.describe("Export Functionality", () => {
  test("should export M4A file successfully", async ({ page }) => {
    // Get the absolute path to the HTML file and test audio
    const htmlPath = path.resolve(__dirname, "../dist/index.html");
    const audioPath = path.resolve(__dirname, "middle-c.mp3");

    console.log("HTML path:", htmlPath);
    console.log("Audio path:", audioPath);

    // Navigate to the HTML file
    await page.goto(`file://${htmlPath}`);

    // Wait for the page to load completely
    await page.waitForLoadState("networkidle");

    // Add console logging to capture debug info
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      consoleMessages.push(text);
      console.log(`Browser console: ${text}`);
    });

    // Capture any errors
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      const message = error.message;
      errors.push(message);
      console.error(`Browser error: ${message}`);
    });

    // Wait for the app to initialize
    await page.waitForSelector("#dropZone", { timeout: 10000 });

    // Upload the middle-c.mp3 file
    const fileInput = page.locator("#fileInput");
    await fileInput.setInputFiles(audioPath);

    // Wait for the file to be processed
    await page.waitForFunction(
      () => {
        const status = document.querySelector("#status");
        return status && status.textContent !== "Ready to load audio file";
      },
      { timeout: 30000 }
    );

    // Wait for controls to become visible
    await page.waitForSelector("#controls.visible", { timeout: 15000 });

    // Set the pitch slider to +2 semitones (a small shift for testing)
    const pitchSlider = page.locator("#pitchSlider");
    await pitchSlider.fill("2");

    // Click preview button to process the audio
    const previewBtn = page.locator("#previewBtn");
    await expect(previewBtn).toBeEnabled();
    await previewBtn.click();

    // Wait for processing to complete
    await page.waitForFunction(
      () => {
        const btn = document.querySelector("#previewBtn") as HTMLButtonElement;
        return btn && btn.textContent === "Preview" && !btn.disabled;
      },
      { timeout: 30000 }
    );

    // Wait for export button to be enabled
    const exportBtn = page.locator("#exportBtn");
    await expect(exportBtn).toBeEnabled();

    // Click the export button
    await exportBtn.click();

    // Wait for export to complete by checking console messages
    let exportCompleted = false;
    const maxWait = 60000; // 60 seconds
    const startTime = Date.now();

    while (!exportCompleted && Date.now() - startTime < maxWait) {
      await page.waitForTimeout(1000); // Check every second
      exportCompleted = consoleMessages.some(
        (msg) =>
          msg.includes("M4A export completed successfully") ||
          msg.includes("Export completed") ||
          msg.includes("Successfully encoded")
      );
    }

    if (!exportCompleted) {
      throw new Error("Export did not complete within timeout");
    }

    console.log("Export completed successfully");

    // Check for export-related console messages
    const exportMessages = consoleMessages.filter(
      (msg) =>
        msg.includes("export") ||
        msg.includes("Export") ||
        msg.includes("FFmpeg")
    );

    console.log("Export-related messages:", exportMessages);

    // Check for any serious export errors (exclude media resource warnings)
    const exportErrors = consoleMessages.filter(
      (msg) =>
        msg.includes("Failed to load FFmpeg") ||
        msg.includes("Error during M4A export") ||
        msg.includes("failed to import ffmpeg-core.js")
    );

    if (exportErrors.length > 0) {
      console.error("Found export errors:", exportErrors);
    }

    // Log all console messages for debugging
    console.log("All console messages:", consoleMessages);

    // Verify no critical errors occurred
    expect(errors.length).toBe(0);

    // Verify no serious export errors (ignore media resource warnings)
    expect(exportErrors.length).toBe(0);

    console.log("Export test completed successfully!");
  });
});
