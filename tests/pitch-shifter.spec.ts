import { test, expect } from "@playwright/test";
import path from "path";
import { analyzePitch } from "./helpers/pitch-detection";

test.describe("Pitch Shifter", () => {
  test("should shift middle C up 7 semitones to G and preserve duration", async ({
    page,
  }) => {
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

    // Check if the app is ready
    const statusText = await page.textContent("#status");
    console.log("Initial status:", statusText);

    // Upload the middle-c.mp3 file
    const fileInput = page.locator("#fileInput");
    await fileInput.setInputFiles(audioPath);

    // Wait for the file to be processed (look for status change)
    await page.waitForFunction(
      () => {
        const status = document.querySelector("#status");
        return status && status.textContent !== "Ready to load audio file";
      },
      { timeout: 30000 }
    );

    // Wait for controls to become visible
    await page.waitForSelector("#controls.visible", { timeout: 15000 });

    // Get original audio duration
    const originalAudio = page.locator("#originalAudio");
    await originalAudio.waitFor({ state: "visible" });

    // Wait for audio metadata to load
    await page.waitForFunction(
      () => {
        const audio = document.querySelector(
          "#originalAudio"
        ) as HTMLAudioElement;
        return audio && audio.duration > 0;
      },
      { timeout: 10000 }
    );

    const originalDuration = await page.evaluate(() => {
      const audio = document.querySelector(
        "#originalAudio"
      ) as HTMLAudioElement;
      return audio.duration;
    });

    console.log("Original duration:", originalDuration);

    // Set the pitch slider to +7 semitones (middle C to G)
    const pitchSlider = page.locator("#pitchSlider");
    await pitchSlider.fill("7");

    // Verify slider value is displayed correctly
    const sliderValue = await page.textContent("#sliderValue");
    expect(sliderValue).toBe("7");

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

    // Wait for processed audio to appear
    await page.waitForSelector('#processedAudio[style*="block"]', {
      timeout: 10000,
    });

    // Wait for processed audio metadata to load
    await page.waitForFunction(
      () => {
        const audio = document.querySelector(
          "#processedAudio"
        ) as HTMLAudioElement;
        return audio && audio.duration > 0;
      },
      { timeout: 10000 }
    );

    // Get processed audio duration
    const processedDuration = await page.evaluate(() => {
      const audio = document.querySelector(
        "#processedAudio"
      ) as HTMLAudioElement;
      return audio.duration;
    });

    console.log("Processed duration:", processedDuration);

    // Verify duration is preserved (within 1% tolerance)
    const durationDiff = Math.abs(originalDuration - processedDuration);
    const tolerance = originalDuration * 0.01; // 1% tolerance
    expect(durationDiff).toBeLessThan(tolerance);

    // Analyze the pitch of the processed audio
    const pitchAnalysis = await analyzePitch(page, "#processedAudio");

    console.log("Pitch analysis result:", pitchAnalysis);

    // Verify the pitch was shifted correctly
    // Middle C (C4) + 7 semitones = G4
    expect(pitchAnalysis.note).toBe("G");

    // Verify semitones shift (should be around 7 from original C)
    expect(pitchAnalysis.semitonesFromC4).toBeGreaterThanOrEqual(5);
    expect(pitchAnalysis.semitonesFromC4).toBeLessThanOrEqual(7);

    // Check for any console errors that might indicate NaN issues
    const nanErrors = consoleMessages.filter(
      (msg) => msg.includes("NaN") || msg.includes("Inf") || msg.includes("nan")
    );

    if (nanErrors.length > 0) {
      console.error("Found NaN/Inf errors in console:", nanErrors);
    }

    // Log all console messages for debugging
    console.log("All console messages:", consoleMessages);

    // Verify no critical errors occurred
    expect(errors.length).toBe(0);

    // The test passes if we get here without errors
    console.log("Test completed successfully!");
  });
});

