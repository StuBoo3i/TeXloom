import test from 'node:test'
import assert from 'node:assert/strict'
import { paddedBounds, pdfContentBounds } from '../client/src/pdf-content-bounds'

function blank(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  pixels.fill(255)
  return pixels
}

test('卡片预览只保留图表实际内容并保留留白边距', () => {
  const width = 100; const height = 80
  const pixels = blank(width, height)
  for (let y = 20; y < 40; y++) for (let x = 30; x < 70; x++) {
    const at = (y * width + x) * 4
    pixels[at] = 40; pixels[at + 1] = 80; pixels[at + 2] = 120
  }
  const content = pdfContentBounds(pixels, width, height)
  assert.deepEqual(content, { x: 30, y: 20, width: 40, height: 20 })
  assert.deepEqual(paddedBounds(content!, width, height, 5), { x: 25, y: 15, width: 50, height: 30 })
})

test('空白页面与无效尺寸不产生错误裁切', () => {
  assert.equal(pdfContentBounds(blank(12, 12), 12, 12), null)
  assert.equal(pdfContentBounds(new Uint8ClampedArray(), 0, 0), null)
  assert.deepEqual(paddedBounds({ x: 1, y: 1, width: 8, height: 8 }, 10, 10, 5), { x: 0, y: 0, width: 10, height: 10 })
})
