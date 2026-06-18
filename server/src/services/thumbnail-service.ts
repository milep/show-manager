import { runCommand, type CommandRunner } from "./run-command.js";

export class ThumbnailService {
  constructor(private readonly run: CommandRunner = runCommand) {}

  async createThumbnail(sourcePath: string, targetPath: string): Promise<void> {
    await this.run("ffmpeg", ["-y", "-i", sourcePath, "-frames:v", "1", "-vf", "scale=640:-1", targetPath]);
  }

  async probe(sourcePath: string): Promise<{ durationSeconds: number | null; width: number | null; height: number | null }> {
    const result = await this.run("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      sourcePath,
    ]);
    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
      format?: { duration?: string };
    };
    const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video") ?? null;
    const durationValue = videoStream?.duration ?? parsed.format?.duration ?? null;
    return {
      durationSeconds: durationValue ? Number(durationValue) : null,
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
    };
  }
}
