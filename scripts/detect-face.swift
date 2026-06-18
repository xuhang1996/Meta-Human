import AppKit
import Foundation
import Vision

struct Point: Encodable {
    let x: Double
    let y: Double
}

struct Rect: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct EyeFeature: Encodable {
    let center: Point
    let bounds: Rect
}

struct MouthFeature: Encodable {
    let center: Point
    let bounds: Rect
}

struct FaceFeatureResult: Encodable {
    let imageWidth: Int
    let imageHeight: Int
    let faceBounds: Rect
    let leftEye: EyeFeature
    let rightEye: EyeFeature
    let mouth: MouthFeature
    let innerMouth: MouthFeature?
    let skinColor: String
    let lipColor: String
}

enum FaceScriptError: Error {
    case invalidArguments
    case imageLoadFailed
    case bitmapFailed
    case noFaceDetected
    case landmarksMissing
}

func toTopLeftPoint(_ point: CGPoint, in bbox: CGRect) -> Point {
    let normalizedX = bbox.origin.x + point.x * bbox.size.width
    let normalizedY = 1.0 - (bbox.origin.y + point.y * bbox.size.height)
    return Point(x: normalizedX, y: normalizedY)
}

func bounds(for points: [Point]) -> Rect {
    let xs = points.map(\.x)
    let ys = points.map(\.y)
    let minX = xs.min() ?? 0
    let maxX = xs.max() ?? 0
    let minY = ys.min() ?? 0
    let maxY = ys.max() ?? 0
    return Rect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
}

func center(for rect: Rect) -> Point {
    Point(x: rect.x + rect.width / 2, y: rect.y + rect.height / 2)
}

func clamp(_ value: Int, min: Int, max: Int) -> Int {
    Swift.max(min, Swift.min(max, value))
}

func averageColor(
    bitmap: NSBitmapImageRep,
    center: Point,
    radius: Int,
    imageWidth: Int,
    imageHeight: Int
) -> String {
    let pixelX = clamp(Int(center.x * Double(imageWidth)), min: 0, max: imageWidth - 1)
    let pixelY = clamp(Int(center.y * Double(imageHeight)), min: 0, max: imageHeight - 1)

    var redTotal = 0.0
    var greenTotal = 0.0
    var blueTotal = 0.0
    var sampleCount = 0.0

    for offsetY in -radius...radius {
      for offsetX in -radius...radius {
        let sampleX = clamp(pixelX + offsetX, min: 0, max: imageWidth - 1)
        let sampleY = clamp(pixelY + offsetY, min: 0, max: imageHeight - 1)

        guard let color = bitmap.colorAt(x: sampleX, y: sampleY) else {
          continue
        }

        let rgb = color.usingColorSpace(.deviceRGB) ?? color
        redTotal += Double(rgb.redComponent)
        greenTotal += Double(rgb.greenComponent)
        blueTotal += Double(rgb.blueComponent)
        sampleCount += 1
      }
    }

    if sampleCount == 0 {
      return "#caa58d"
    }

    let red = Int((redTotal / sampleCount) * 255.0)
    let green = Int((greenTotal / sampleCount) * 255.0)
    let blue = Int((blueTotal / sampleCount) * 255.0)

    return String(format: "#%02X%02X%02X", red, green, blue)
}

let output = FileHandle.standardOutput

do {
    guard CommandLine.arguments.count >= 2 else {
        throw FaceScriptError.invalidArguments
    }

    let imageUrl = URL(fileURLWithPath: CommandLine.arguments[1])

    guard let image = NSImage(contentsOf: imageUrl), let tiff = image.tiffRepresentation else {
        throw FaceScriptError.imageLoadFailed
    }

    guard let bitmap = NSBitmapImageRep(data: tiff), let cgImage = bitmap.cgImage else {
        throw FaceScriptError.bitmapFailed
    }

    let request = VNDetectFaceLandmarksRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    guard let observation = request.results?.first else {
        throw FaceScriptError.noFaceDetected
    }

    guard
        let landmarks = observation.landmarks,
        let leftEyeRaw = landmarks.leftEye?.normalizedPoints,
        let rightEyeRaw = landmarks.rightEye?.normalizedPoints,
        let lipsRaw = landmarks.outerLips?.normalizedPoints
    else {
        throw FaceScriptError.landmarksMissing
    }

    let bbox = observation.boundingBox
    let faceBounds = Rect(
        x: bbox.origin.x,
        y: 1.0 - bbox.origin.y - bbox.size.height,
        width: bbox.size.width,
        height: bbox.size.height
    )

    let leftEyePoints = leftEyeRaw.map { toTopLeftPoint($0, in: bbox) }
    let rightEyePoints = rightEyeRaw.map { toTopLeftPoint($0, in: bbox) }
    let lipPoints = lipsRaw.map { toTopLeftPoint($0, in: bbox) }
    let innerLipPoints = landmarks.innerLips?.normalizedPoints.map { toTopLeftPoint($0, in: bbox) }

    let leftEyeBounds = bounds(for: leftEyePoints)
    let rightEyeBounds = bounds(for: rightEyePoints)
    let mouthBounds = bounds(for: lipPoints)
    let innerMouthFeature: MouthFeature?

    if let innerLipPoints, !innerLipPoints.isEmpty {
        let innerMouthBounds = bounds(for: innerLipPoints)
        innerMouthFeature = MouthFeature(
            center: center(for: innerMouthBounds),
            bounds: innerMouthBounds
        )
    } else {
        innerMouthFeature = nil
    }

    let skinSampleCenter = Point(
        x: faceBounds.x + faceBounds.width * 0.28,
        y: faceBounds.y + faceBounds.height * 0.58
    )
    let skinSampleCenter2 = Point(
        x: faceBounds.x + faceBounds.width * 0.72,
        y: faceBounds.y + faceBounds.height * 0.58
    )
    let lipSampleCenter = center(for: mouthBounds)

    let skinColor1 = averageColor(
        bitmap: bitmap,
        center: skinSampleCenter,
        radius: 8,
        imageWidth: bitmap.pixelsWide,
        imageHeight: bitmap.pixelsHigh
    )
    let skinColor2 = averageColor(
        bitmap: bitmap,
        center: skinSampleCenter2,
        radius: 8,
        imageWidth: bitmap.pixelsWide,
        imageHeight: bitmap.pixelsHigh
    )
    let lipColor = averageColor(
        bitmap: bitmap,
        center: lipSampleCenter,
        radius: 6,
        imageWidth: bitmap.pixelsWide,
        imageHeight: bitmap.pixelsHigh
    )

    let result = FaceFeatureResult(
        imageWidth: bitmap.pixelsWide,
        imageHeight: bitmap.pixelsHigh,
        faceBounds: faceBounds,
        leftEye: EyeFeature(center: center(for: leftEyeBounds), bounds: leftEyeBounds),
        rightEye: EyeFeature(center: center(for: rightEyeBounds), bounds: rightEyeBounds),
        mouth: MouthFeature(center: lipSampleCenter, bounds: mouthBounds),
        innerMouth: innerMouthFeature,
        skinColor: skinColor1 == "#000000" ? skinColor2 : skinColor1,
        lipColor: lipColor
    )

    let encoder = JSONEncoder()
    let data = try encoder.encode(result)
    output.write(data)
} catch FaceScriptError.invalidArguments {
    fputs("detect-face.swift requires an image path.\n", stderr)
    exit(2)
} catch FaceScriptError.imageLoadFailed {
    fputs("Failed to load image.\n", stderr)
    exit(3)
} catch FaceScriptError.bitmapFailed {
    fputs("Failed to decode bitmap.\n", stderr)
    exit(4)
} catch FaceScriptError.noFaceDetected {
    fputs("No face detected.\n", stderr)
    exit(5)
} catch FaceScriptError.landmarksMissing {
    fputs("Face detected but landmarks were unavailable.\n", stderr)
    exit(6)
} catch {
    fputs("Unexpected Vision failure: \(error)\n", stderr)
    exit(7)
}
