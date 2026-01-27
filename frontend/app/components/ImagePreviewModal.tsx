'use client'

import { X, MagicWand } from '@phosphor-icons/react'
import { useEffect } from 'react'

interface ImagePreviewModalProps {
    isOpen: boolean
    onClose: () => void
    imageSrc: string | null
    onExtract: () => void
    isProcessing: boolean
}

export default function ImagePreviewModal({
    isOpen,
    onClose,
    imageSrc,
    onExtract,
    isProcessing
}: ImagePreviewModalProps) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }

        if (isOpen) {
            document.addEventListener('keydown', handleEscape)
            document.body.style.overflow = 'hidden'
        }

        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = 'unset'
        }
    }, [isOpen, onClose])

    if (!isOpen || !imageSrc) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
                onClick={!isProcessing ? onClose : undefined}
            />

            {/* Modal Content */}
            <div className="relative z-10 w-auto max-w-[95vw] h-auto max-h-[95vh] flex flex-col glass-card rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/20 shrink-0 min-w-[320px]">
                    <h2 className="text-base font-semibold text-white">Scan Preview</h2>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        disabled={isProcessing}
                    >
                        <X size={18} weight="bold" />
                    </button>
                </div>

                {/* Image Container - Width driven by image, height constrained by viewport less header/footer */}
                <div className="overflow-auto bg-black/40 flex items-center justify-center p-2">
                    <img
                        src={imageSrc}
                        alt="Scan Preview"
                        className="w-auto h-auto max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg"
                    />
                </div>

                {/* Footer */}
                <div className="px-3 py-2 border-t border-white/10 bg-black/20 flex justify-end gap-2 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-sm rounded-lg border border-white/10 hover:bg-white/5 text-gray-300 transition-colors"
                        disabled={isProcessing}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onExtract}
                        className="btn-primary px-4 py-1.5 text-sm"
                        disabled={isProcessing}
                    >
                        {isProcessing ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <MagicWand className="mr-1.5 text-base" weight="bold" />
                                Extract Text
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
