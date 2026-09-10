import { lazy } from 'react'

export const CameraScanPage = lazy(() => import('../../pages/ServerCameraScanPage').then((module) => ({ default: module.ServerCameraScanPage })))
export const PhotoUploadPage = lazy(() => import('../../pages/ServerPhotoUploadPage').then((module) => ({ default: module.ServerPhotoUploadPage })))
