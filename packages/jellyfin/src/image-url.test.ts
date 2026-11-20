import { describe, expect, it } from "vitest";

import { ItemId, ServerUrl } from "./ids";
import { imageUrl } from "./image-url";

const server = ServerUrl.parse("http://jf.test:8096");
const itemId = ItemId.parse("0123456789abcdef0123456789abcdef");

describe(imageUrl, () => {
  it("a sized, tagged poster URL", () => {
    expect(
      imageUrl(server, itemId, "Primary", { maxWidth: 342.4, tag: "abc123", quality: 90 })
    ).toBe(
      "http://jf.test:8096/Items/0123456789abcdef0123456789abcdef/Images/Primary?maxWidth=342&tag=abc123&quality=90"
    );
  });

  it("a backdrop by index without a tag, under a server path prefix", () => {
    expect(
      imageUrl(ServerUrl.parse("https://media.example/jellyfin"), itemId, "Backdrop", {
        maxWidth: 3840,
        tag: null,
        index: 1,
      })
    ).toBe(
      "https://media.example/jellyfin/Items/0123456789abcdef0123456789abcdef/Images/Backdrop/1?maxWidth=3840"
    );
  });
});
