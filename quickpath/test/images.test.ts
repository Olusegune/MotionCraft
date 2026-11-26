import { test } from "node:test";
import assert from "node:assert/strict";
import { imageInfo, PICTURE_NAME } from "../src/images.ts";
import { jpegHeader, solidPng } from "./png.ts";

test("a PNG is recognised by its bytes and its size is read", () => {
  assert.deepEqual(imageInfo(solidPng(40, 30, [1, 2, 3])), { ext: "png", width: 40, height: 30 });
});

test("a JPEG is recognised by its bytes and its size is read", () => {
  assert.deepEqual(imageInfo(jpegHeader(800, 600)), { ext: "jpg", width: 800, height: 600 });
});

test("anything else is refused: text, GIF, SVG, an empty file, a lying extension", () => {
  for (const b of [Buffer.from("hello"), Buffer.from("GIF89a......................"), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), Buffer.alloc(0), Buffer.from("<?php echo 1;?>")]) {
    assert.equal(imageInfo(b), null);
  }
});

test("a picture with a zero or absurd size is refused", () => {
  assert.equal(imageInfo(solidPng(1, 1, [0, 0, 0]))?.width, 1);
  assert.equal(imageInfo(jpegHeader(0, 10)), null);
  assert.equal(imageInfo(jpegHeader(60000, 10)), null);
});

test("only names the server made pass the name check", () => {
  assert.ok(PICTURE_NAME.test("0123456789ab.png"));
  assert.ok(PICTURE_NAME.test("0123456789ab.jpg"));
  for (const bad of ["../0123456789ab.png", "0123456789ab.svg", "0123456789ab.png.exe", "short.png", "0123456789AB.png", "0123456789ab.png\n", "a/b.png"]) assert.ok(!PICTURE_NAME.test(bad), bad);
});
