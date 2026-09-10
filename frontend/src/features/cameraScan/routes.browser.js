import { lazy } from 'react'

export const CameraScanPage = lazy(() => import('../../pages/CameraScanPage').then((module) => ({ default: module.CameraScanPage })))
export const PhotoUploadPage = lazy(() => import('../../pages/PhotoUploadPage').then((module) => ({ default: module.PhotoUploadPage })))
