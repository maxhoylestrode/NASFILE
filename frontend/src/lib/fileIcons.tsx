import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileType,
  File as FileIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * Drive-style color-coded file icons, keyed off extension. Deliberately
 * simple (extension only, no MIME sniffing) — matches what the backend
 * actually gives us (a filename) and what users recognize at a glance.
 */
const CATEGORIES: { extensions: string[]; icon: LucideIcon; color: string }[] = [
  {
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif'],
    icon: FileImage,
    color: 'text-emerald-500',
  },
  {
    extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'],
    icon: FileVideo,
    color: 'text-rose-500',
  },
  {
    extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'],
    icon: FileAudio,
    color: 'text-purple-500',
  },
  {
    extensions: ['zip', 'tar', 'gz', 'rar', '7z', 'iso', 'bz2', 'xz'],
    icon: FileArchive,
    color: 'text-amber-600',
  },
  {
    extensions: ['xls', 'xlsx', 'csv', 'tsv'],
    icon: FileSpreadsheet,
    color: 'text-green-600',
  },
  {
    extensions: ['pdf'],
    icon: FileType,
    color: 'text-red-500',
  },
  {
    extensions: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md'],
    icon: FileText,
    color: 'text-blue-500',
  },
  {
    extensions: [
      'js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'json', 'yml', 'yaml', 'sh', 'html', 'css',
    ],
    icon: FileCode,
    color: 'text-sky-500',
  },
];

export function getFileIcon(name: string): { icon: LucideIcon; color: string } {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const match = CATEGORIES.find((c) => c.extensions.includes(ext));
  return match ?? { icon: FileIcon, color: 'text-slate-400 dark:text-slate-500' };
}
