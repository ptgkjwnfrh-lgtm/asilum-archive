// scripts/make-motion-sample.swift — generate public/model/motion-test-pattern.mp4
// (V.2 slice 9). A SYNTHETIC test pattern, drawn by CoreGraphics and encoded
// by AVFoundation (H.264 in an MP4 container, fast-start, with a generated
// AAC test tone so the housing's KEEP AUDIO and the music circle can be
// exercised):
// the only MOTION the repository ships, so the housing can be exercised on
// a deployment with no video uploads. It is labelled GENERATED TEST PATTERN
// on every surface, like the generated gradient covers — never a fashion
// film, never a person. macOS only (AVFoundation):
//
//   swift scripts/make-motion-sample.swift public/model/motion-test-pattern.mp4
//
// 320×180, 12 fps, 6 seconds: a hue sweep with a moving bar and a dark lower
// third for the on-media caption's ink to read; a quiet 220 Hz tone that
// swells and fades, so nobody mistakes it for music. ~60 KB.
import AVFoundation
import CoreGraphics
import Foundation

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "public/model/motion-test-pattern.mp4"
let url = URL(fileURLWithPath: out)
try? FileManager.default.removeItem(at: url)
let w = 320, h = 180, fps: Int32 = 12, seconds = 6
let writer = try! AVAssetWriter(outputURL: url, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true   // moov before mdat (fast start)
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 160_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h])
writer.add(input)
// the tone: mono 22.05 kHz PCM in, AAC out
let sampleRate = 22050.0
var asbd = AudioStreamBasicDescription(mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked, mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
var fmt: CMAudioFormatDescription?
CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &fmt)
let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 48_000])
audioInput.expectsMediaDataInRealTime = false
writer.add(audioInput)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
if CommandLine.arguments.contains("--debug") { print("status \(writer.status.rawValue) video ready \(input.isReadyForMoreMediaData) audio ready \(audioInput.isReadyForMoreMediaData)") }
let total = Int(fps) * seconds
let frames = Int(sampleRate) * seconds
var pcm = [Int16](repeating: 0, count: frames)
for i in 0..<frames {
  let t = Double(i) / sampleRate
  let env = sin(.pi * t / Double(seconds))             // 0 → 1 → 0 over the clip
  pcm[i] = Int16(4000.0 * env * sin(2 * .pi * 220 * t))
}
func audioChunk(_ i: Int) -> CMSampleBuffer? {
  let from = i * frames / total, to = (i + 1) * frames / total
  let count = to - from
  if count <= 0 { return nil }
  var block: CMBlockBuffer?
  let bytes = count * 2
  CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: 0, blockBufferOut: &block)
  pcm.withUnsafeBytes { raw in _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!.advanced(by: from * 2), blockBuffer: block!, offsetIntoDestination: 0, dataLength: bytes) }
  var sample: CMSampleBuffer?
  CMAudioSampleBufferCreateWithPacketDescriptions(allocator: nil, dataBuffer: block!, dataReady: true, makeDataReadyCallback: nil, refcon: nil, formatDescription: fmt!, sampleCount: count, presentationTimeStamp: CMTime(value: CMTimeValue(from), timescale: Int32(sampleRate)), packetDescriptions: nil, sampleBufferOut: &sample)
  return sample
}
func frame(_ i: Int) -> CVPixelBuffer? {
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  guard let buf = pb else { return nil }
  CVPixelBufferLockBaseAddress(buf, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: w, height: h, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  let t = Double(i) / Double(total)
  // the hue sweep: the upper two thirds brighten and shift; the lower third stays dark
  func rgb(_ hh: Double, _ s: Double, _ v: Double) -> (CGFloat, CGFloat, CGFloat) {
    let c = v * s, x = c * (1 - abs((hh * 6).truncatingRemainder(dividingBy: 2) - 1)), m = v - c
    let (r, g, b): (Double, Double, Double)
    switch Int(hh * 6) % 6 { case 0: (r, g, b) = (c, x, 0); case 1: (r, g, b) = (x, c, 0); case 2: (r, g, b) = (0, c, x); case 3: (r, g, b) = (0, x, c); case 4: (r, g, b) = (x, 0, c); default: (r, g, b) = (c, 0, x) }
    return (CGFloat(r + m), CGFloat(g + m), CGFloat(b + m))
  }
  let (r, g, b) = rgb(t, 0.35, 0.55 + 0.35 * sin(t * .pi))
  ctx.setFillColor(red: r, green: g, blue: b, alpha: 1)
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.setFillColor(red: 0.06, green: 0.08, blue: 0.09, alpha: 1)
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h / 3))           // CG origin is bottom-left: the lower third
  ctx.setFillColor(red: 0.95, green: 0.95, blue: 0.95, alpha: 1)
  let bx = Int(Double(w - 24) * (0.5 - 0.5 * cos(t * 2 * .pi)))
  ctx.fill(CGRect(x: bx, y: h / 3 + 20, width: 24, height: h - h / 3 - 40))  // the moving bar
  CVPixelBufferUnlockBaseAddress(buf, [])
  return buf
}
// the writer pulls from each input on its own queue (the documented way to
// feed two interleaved inputs; manual readiness loops stall)
let done = DispatchGroup()
var vi = 0, ai = 0
done.enter()
input.requestMediaDataWhenReady(on: DispatchQueue(label: "video")) {
  while input.isReadyForMoreMediaData {
    if vi >= total { input.markAsFinished(); done.leave(); return }
    if let buf = frame(vi) { adaptor.append(buf, withPresentationTime: CMTime(value: CMTimeValue(vi), timescale: fps)) }
    vi += 1
  }
}
done.enter()
audioInput.requestMediaDataWhenReady(on: DispatchQueue(label: "audio")) {
  while audioInput.isReadyForMoreMediaData {
    if ai >= total { audioInput.markAsFinished(); done.leave(); return }
    if let chunk = audioChunk(ai) { audioInput.append(chunk) }
    ai += 1
  }
}
if done.wait(timeout: .now() + 60) == .timedOut { print("failed: the writer stalled (\(vi) frames, \(ai) chunks): \(String(describing: writer.error))"); exit(1) }
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
print(writer.status == .completed ? "wrote \(out)" : "failed: \(String(describing: writer.error))")
