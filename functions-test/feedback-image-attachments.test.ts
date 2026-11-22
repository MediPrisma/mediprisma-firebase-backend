import {
  MAX_FEEDBACK_TOTAL_IMAGE_BYTES,
  validateFeedbackImages,
} from "../functions/src/services/feedback/image-attachments";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("production feedback image validation", () => {
  it("accepts supported image bytes and derives a safe attachment extension", () => {
    const data = PNG_HEADER.toString("base64");
    expect(validateFeedbackImages([{contentType: "image/png", data}])).toEqual({
      ok: true,
      images: [{
        contentType: "image/png",
        data,
        extension: "png",
        size: PNG_HEADER.length,
      }],
    });
  });

  it("rejects invalid MIME types, spoofed signatures, and excess image count", () => {
    const data = PNG_HEADER.toString("base64");
    expect(validateFeedbackImages([{contentType: "image/gif", data}]))
      .toEqual({ok: false, status: 400});
    expect(validateFeedbackImages([{contentType: "image/jpeg", data}]))
      .toEqual({ok: false, status: 400});
    const image = {contentType: "image/png", data};
    expect(validateFeedbackImages([image, image, image, image]))
      .toEqual({ok: false, status: 400});
  });

  it("rejects more than 8 MB of decoded image data", () => {
    const atLimit = Buffer.alloc(8 * 1024 * 1024);
    PNG_HEADER.copy(atLimit);
    const atLimitResult = validateFeedbackImages([{
      contentType: "image/png",
      data: atLimit.toString("base64"),
    }]);
    expect(atLimitResult.ok).toBe(true);
    if (atLimitResult.ok) {
      expect(atLimitResult.images[0].size)
        .toBe(MAX_FEEDBACK_TOTAL_IMAGE_BYTES);
    }

    const oversized = Buffer.alloc(MAX_FEEDBACK_TOTAL_IMAGE_BYTES + 1);
    PNG_HEADER.copy(oversized);
    expect(validateFeedbackImages([{
      contentType: "image/png",
      data: oversized.toString("base64"),
    }])).toEqual({ok: false, status: 413});
  });
});
