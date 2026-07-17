import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"

const source = resolve("tools/browser-extensions/ebay-product-research-capture")
const outputPaths = [
  "public/seller-os-tools/ebay-product-research-capture-extension.zip",
  "public/seller-os-tools/ebay-product-research-capture-extension-v1.0.3.zip",
]
const files = ["manifest.json", "content.js", "README.md"]

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1
    ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function uint16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function uint32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

const localParts = []
const centralParts = []
let offset = 0

for (const file of files) {
  const data = readFileSync(resolve(source, file))
  const name = Buffer.from(basename(file), "utf8")
  const checksum = crc32(data)
  const local = Buffer.concat([
    uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0),
    uint16(0), uint16(0), uint32(checksum), uint32(data.length), uint32(data.length),
    uint16(name.length), uint16(0), name, data,
  ])
  localParts.push(local)
  centralParts.push(Buffer.concat([
    uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0),
    uint16(0), uint16(0), uint32(checksum), uint32(data.length), uint32(data.length),
    uint16(name.length), uint16(0), uint16(0), uint16(0), uint16(0), uint32(0),
    uint32(offset), name,
  ]))
  offset += local.length
}

const central = Buffer.concat(centralParts)
const archive = Buffer.concat([
  ...localParts,
  central,
  uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
  uint32(central.length), uint32(offset), uint16(0),
])

mkdirSync(resolve("public/seller-os-tools"), { recursive: true })
for (const output of outputPaths) writeFileSync(resolve(output), archive)
console.log(JSON.stringify({ outputs: outputPaths,
  files: files.length, bytes: archive.length, deterministic: true }))
