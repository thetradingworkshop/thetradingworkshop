// Video/clip attachments for trade reviews and journal entries — see
// MediaAttachment in src/types.ts. Unlike the base64-data-URI trick used
// for screenshots (src/lib/imageProcessing.ts), a video is uploaded to
// Firebase Storage directly; only its download URL and enough metadata to
// render/delete it later gets stored in Firestore.
import { v4 as uuidv4 } from 'uuid';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTaskSnapshot,
} from 'firebase/storage';
import { storage } from '../firebase';
import { MediaAttachment } from '../types';

export const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // matches storage.rules' write cap

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

// Resolves once the file is fully uploaded and its metadata doc is ready to
// save; `onProgress` fires with 0-100 as the upload streams (Storage's own
// resumable-upload progress events), separate from `onProgress` resolving.
export function uploadMediaFile(
  file: File,
  userId: string,
  onProgress?: (percent: number) => void
): Promise<MediaAttachment> {
  return new Promise((resolve, reject) => {
    if (!isVideoFile(file)) {
      reject(new Error('That file is not a video.'));
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      reject(new Error(`That video is too large (max ${Math.floor(MAX_VIDEO_BYTES / (1024 * 1024))}MB).`));
      return;
    }

    const id = uuidv4();
    const storagePath = `media/${userId}/${id}-${file.name}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

    task.on(
      'state_changed',
      (snapshot: UploadTaskSnapshot) => {
        onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
      },
      (error) => reject(error),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            id,
            url,
            storagePath,
            contentType: file.type,
            fileName: file.name,
            size: file.size,
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

export async function deleteMediaFile(attachment: MediaAttachment): Promise<void> {
  await deleteObject(ref(storage, attachment.storagePath));
}
