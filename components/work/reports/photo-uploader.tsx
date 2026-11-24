"use client";

import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { addPhoto, deletePhoto } from "@/app/(app)/reports/actions";
import { Button } from "@/components/work/ui/button";
import { FormError } from "@/components/work/ui/form";
import { PHOTO_BUCKET } from "@/lib/work/constants";
import type { PhotoView } from "@/lib/work/reports";
import { createClient } from "@/lib/work/supabase/client";

const MAX_EDGE = 1600;
const MAX_PHOTOS = 20;

/** 휴대폰 사진을 긴 변 1600px JPEG 로 줄인다. 변환할 수 없는 형식이면 원본을 그대로 쓴다. */
async function shrink(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (blob) return { blob, ext: "jpg", type: "image/jpeg" };
  } catch {
    // 브라우저가 해석하지 못하는 형식(HEIC 등)은 원본으로 올린다
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return { blob: file, ext, type: file.type || "image/jpeg" };
}

export function PhotoUploader({
  projectId,
  initial,
  ensureReportId,
}: {
  projectId: string;
  initial: PhotoView[];
  /** 아직 저장되지 않은 작업일보라면 임시저장 후 id 를 돌려준다. 실패하면 null. */
  ensureReportId: () => Promise<string | null>;
}) {
  const [photos, setPhotos] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    if (photos.length + files.length > MAX_PHOTOS) {
      setError(`사진은 작업일보당 ${MAX_PHOTOS}장까지 등록할 수 있습니다.`);
      return;
    }
    setBusy(true);
    try {
      const reportId = await ensureReportId();
      if (!reportId) return;
      const supabase = createClient();
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          setError("이미지 파일만 등록할 수 있습니다.");
          continue;
        }
        const { blob, ext, type } = await shrink(file);
        const path = `${projectId}/${reportId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: type });
        if (uploadError) {
          setError(`사진을 올리지 못했습니다. (${uploadError.message})`);
          continue;
        }
        const result = await addPhoto(reportId, path, "");
        if (!result.ok) {
          setError(result.error);
          continue;
        }
        setPhotos((prev) => [...prev, result.data!]);
      }
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (albumRef.current) albumRef.current.value = "";
    }
  }

  async function remove(id: string) {
    if (!confirm("이 사진을 삭제할까요?")) return;
    const result = await deletePhoto(id);
    if (!result.ok) return setError(result.error);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" disabled={busy} onClick={() => cameraRef.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <Camera />} 사진 촬영
        </Button>
        <Button variant="outline" size="lg" disabled={busy} onClick={() => albumRef.current?.click()}>
          <ImagePlus /> 앨범에서 선택
        </Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden data-testid="camera-input" onChange={(e) => handleFiles(e.target.files)} />
      <input ref={albumRef} type="file" accept="image/*" multiple hidden data-testid="album-input" onChange={(e) => handleFiles(e.target.files)} />
      <FormError message={error} />
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photo.caption ?? "현장 사진"} className="size-full object-cover" />
              <button
                type="button"
                aria-label="사진 삭제"
                onClick={() => remove(photo.id)}
                className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">사진은 자동으로 축소되어 올라갑니다. ({photos.length}/{MAX_PHOTOS})</p>
    </div>
  );
}
