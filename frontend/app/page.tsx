'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { 
  Notebook, 
  Camera, 
  X, 
  MagicWand, 
  ListChecks, 
  CheckCircle,
  CircleHalf,
  Circle,
  CalendarCheck,
  CalendarBlank,
  Note,
  Question,
  Trash,
  WarningCircle,
  CaretLeft,
  CaretRight,
  Calendar
} from '@phosphor-icons/react'

interface BuJoItem {
  type: 'TASK' | 'EVENT' | 'NOTE'
  status: 'TODO' | 'DONE' | 'IN_PROGRESS' | 'SCHEDULED' | null
  content: string
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

export default function Home() {
  // Scanner state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressStatus, setProgressStatus] = useState('')
  
  // Date navigation state
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [dbItems, setDbItems] = useState<BuJoItem[]>([])
  const [loadingDate, setLoadingDate] = useState(false)
  
  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Load available dates from database
  const loadAvailableDates = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8000/api/scans/dates/all')
      if (response.ok) {
        const data = await response.json()
        setAvailableDates(data.dates || [])
      }
    } catch (error) {
      console.error('Failed to load dates:', error)
    }
  }, [])

  // Load items for selected date
  const loadDateItems = useCallback(async (date: string) => {
    setLoadingDate(true)
    try {
      const response = await fetch(`http://localhost:8000/api/scans/date/${date}`)
      if (response.ok) {
        const data = await response.json()
        setDbItems(data.items || [])
      } else {
        setDbItems([])
      }
    } catch (error) {
      console.error('Failed to load date items:', error)
      setDbItems([])
    } finally {
      setLoadingDate(false)
    }
  }, [])

  // Initialize: load dates and current date items
  useEffect(() => {
    loadAvailableDates()
    loadDateItems(selectedDate)
  }, [selectedDate, loadAvailableDates, loadDateItems])

  // Navigate to previous date
  const navigatePrevious = useCallback(() => {
    if (availableDates.length === 0) return
    
    const currentIndex = availableDates.indexOf(selectedDate)
    if (currentIndex > 0) {
      setSelectedDate(availableDates[currentIndex - 1])
    } else {
      // Go to last date if at first
      setSelectedDate(availableDates[availableDates.length - 1])
    }
  }, [availableDates, selectedDate])

  // Navigate to next date
  const navigateNext = useCallback(() => {
    if (availableDates.length === 0) return
    
    const currentIndex = availableDates.indexOf(selectedDate)
    if (currentIndex < availableDates.length - 1) {
      setSelectedDate(availableDates[currentIndex + 1])
    } else {
      // Go to first date if at last
      setSelectedDate(availableDates[0])
    }
  }, [availableDates, selectedDate])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0]
    if (file) {
      setImageFile(file)
      const reader = new FileReader()
      reader.onload = (event) => {
        setImagePreview(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const removeImage = useCallback(() => {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const processImage = useCallback(async () => {
    if (!imageFile) {
      showToast('Please select an image first', 'error')
      return
    }

    // Store file reference to prevent it from being lost
    const fileToProcess = imageFile

    setIsProcessing(true)
    setProgress(0)
    setProgressStatus('Initializing OCR...')

    try {
      setProgressStatus('Analyzing with Groq VLM...')
      setProgress(30)

      const formData = new FormData()
      formData.append('file', fileToProcess)

      setProgress(60)

      const response = await fetch('http://localhost:8000/api/process-image', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to process image')
      }

      const data = await response.json()
      setProgress(100)
      setProgressStatus('Complete!')

      // Reload dates and items after successful scan
      await loadAvailableDates()
      if (data.date) {
        setSelectedDate(data.date)
        await loadDateItems(data.date)
      }
      
      // Clear image only after successful processing
      removeImage()
      
      // Show appropriate toast based on save status
      if (data.saved_to_db) {
        showToast('Scan complete and saved to database!', 'success')
      } else {
        showToast('Scan complete, but failed to save to database', 'error')
      }
    } catch (error: any) {
      console.error(error)
      showToast(`Error analyzing image: ${error.message}`, 'error')
      // Don't clear image on error so user can retry
    } finally {
      setIsProcessing(false)
      setProgress(0)
      setProgressStatus('')
    }
  }, [imageFile, showToast, loadAvailableDates, loadDateItems, removeImage])

  const updateContent = useCallback((index: number, value: string) => {
    setDbItems(prev => {
      const newItems = [...prev]
      newItems[index].content = value
      return newItems
    })
  }, [])

  const deleteItem = useCallback((index: number) => {
    setDbItems(prev => prev.filter((_, i) => i !== index))
  }, [])

  const cycleType = useCallback((index: number) => {
    setDbItems(prev => {
      const newItems = [...prev]
      const types: BuJoItem['type'][] = ['TASK', 'EVENT', 'NOTE']
      const current = newItems[index].type
      const nextIndex = (types.indexOf(current) + 1) % types.length
      newItems[index].type = types[nextIndex]
      
      if (types[nextIndex] === 'TASK') newItems[index].status = 'TODO'
      else if (types[nextIndex] === 'EVENT') newItems[index].status = 'SCHEDULED'
      else newItems[index].status = null
      
      return newItems
    })
  }, [])

  const toggleStatus = useCallback((index: number) => {
    setDbItems(prev => {
      const newItems = [...prev]
      const item = newItems[index]
      if (item.type === 'TASK') {
        if (item.status === 'TODO') item.status = 'IN_PROGRESS'
        else if (item.status === 'IN_PROGRESS') item.status = 'DONE'
        else item.status = 'TODO'
      }
      return newItems
    })
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      setImageFile(file)
      const reader = new FileReader()
      reader.onload = (event) => {
        setImagePreview(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const getItemIcon = (item: BuJoItem) => {
    const type = item.type.toUpperCase()
    const status = item.status?.toUpperCase() || null

    if (type === 'TASK') {
      if (status === 'DONE') {
        return <CheckCircle className="text-green-500 text-base" weight="fill" />
      } else if (status === 'IN_PROGRESS') {
        return <CircleHalf className="text-yellow-500 text-base" weight="bold" />
      } else {
        return <Circle className="text-brand-400 text-base" weight="bold" />
      }
    } else if (type === 'EVENT') {
      if (status === 'DONE' || status === 'EVENT_COMPLETED') {
        return <CalendarCheck className="text-purple-400 text-base" weight="fill" />
      } else {
        return <CalendarBlank className="text-purple-400 text-base" weight="bold" />
      }
    } else if (type === 'NOTE') {
      return <Note className="text-gray-400 text-base" weight="bold" />
    } else {
      return <Question className="text-gray-500 text-base" weight="bold" />
    }
  }

  const getItemStatusColor = (item: BuJoItem) => {
    const type = item.type.toUpperCase()
    const status = item.status?.toUpperCase() || null

    if (type === 'TASK') {
      if (status === 'DONE') {
        return 'text-green-500 decoration-slate-500 line-through'
      } else if (status === 'IN_PROGRESS') {
        return 'text-gray-100'
      } else {
        return 'text-gray-100'
      }
    } else if (type === 'EVENT') {
      if (status === 'DONE' || status === 'EVENT_COMPLETED') {
        return 'text-purple-400 decoration-purple-500/50 line-through'
      } else {
        return 'text-purple-100'
      }
    } else {
      return 'text-gray-400 italic'
    }
  }

  const hasPrevious = availableDates.length > 0 && availableDates.indexOf(selectedDate) > 0
  const hasNext = availableDates.length > 0 && availableDates.indexOf(selectedDate) < availableDates.length - 1
  const dateExists = availableDates.includes(selectedDate)

  return (
    <div className="relative z-10 max-w-4xl mx-auto px-4 py-4 md:py-6">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-brand-500/10 blur-[120px]"></div>
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px]"></div>
      </div>

      {/* Compact Header */}
      <header className="mb-4 text-center">
        <div className="inline-flex items-center justify-center p-2 mb-2 rounded-xl bg-brand-500/10 border border-brand-500/20">
          <Notebook className="text-2xl text-brand-400" weight="bold" />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-400 mb-1 tracking-tight">
          BuJo Companion
        </h1>
      </header>

      {/* Compact Scanner Section */}
      <section className="glass-card p-3 md:p-4 rounded-2xl mb-6">
        <div
          className="flex items-center gap-3 border-2 border-dashed border-dark-border hover:border-brand-500/50 transition-colors rounded-xl p-3 bg-dark-card/50 cursor-pointer group"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileSelect}
          />
          
          {!imagePreview ? (
            <>
              <div className="w-10 h-10 rounded-full bg-dark-card border border-dark-border flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                <Camera className="text-xl text-gray-400 group-hover:text-brand-400 transition-colors" weight="bold" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200">Tap to Scan Page</p>
                <p className="text-xs text-gray-500">or drop an image here</p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-dark-card shrink-0 relative group/preview">
                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeImage()
                  }}
                  className="absolute inset-0 bg-black/60 hover:bg-red-500/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                >
                  <X className="text-white text-lg" weight="bold" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 truncate">Image ready</p>
                <p className="text-xs text-gray-500">Click to change</p>
              </div>
            </div>
          )}
          
          {imagePreview && !isProcessing && (
            <button 
              onClick={(e) => {
                e.stopPropagation()
                processImage()
              }} 
              className="btn-primary text-sm py-2 px-4 shrink-0"
            >
              <MagicWand className="mr-2" weight="bold" />
              Extract
            </button>
          )}
        </div>

        {/* Processing State */}
        {isProcessing && (
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>{progressStatus}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full bg-dark-card rounded-full overflow-hidden border border-dark-border">
              <div
                className="h-full bg-brand-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>
        )}
      </section>

      {/* Date Navigation and Items Section */}
      <section className="glass-card p-3 md:p-4 rounded-2xl">
        {/* Date Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={navigatePrevious}
            disabled={availableDates.length === 0}
            className="p-1.5 rounded-lg bg-dark-card hover:bg-dark-border border border-dark-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <CaretLeft className="text-lg text-gray-300" weight="bold" />
          </button>
          
          <div className="flex items-center gap-2 flex-1 justify-center">
            <Calendar className="text-brand-400 text-lg" weight="bold" />
            <div className="text-center">
              <div className="text-base font-semibold text-gray-200">{selectedDate}</div>
              {!dateExists && (
                <div className="text-xs text-gray-500 mt-0.5">No data for this date</div>
              )}
            </div>
          </div>
          
          <button
            onClick={navigateNext}
            disabled={availableDates.length === 0}
            className="p-1.5 rounded-lg bg-dark-card hover:bg-dark-border border border-dark-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <CaretRight className="text-lg text-gray-300" weight="bold" />
          </button>
        </div>

        {/* Items List */}
        {loadingDate ? (
          <div className="text-center py-6 text-gray-400 text-sm">Loading...</div>
        ) : dbItems.length > 0 ? (
          <div className="space-y-1.5">
            {dbItems.map((item, index) => (
              <div
                key={index}
                className="glass-card p-2 rounded-lg flex items-center gap-2 hover:bg-dark-card/50 transition-colors"
              >
                <div className="shrink-0 cursor-pointer" onClick={() => toggleStatus(index)}>
                  {getItemIcon(item)}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={item.content || ''}
                    onChange={(e) => updateContent(index, e.target.value)}
                    className={`bg-transparent border-none w-full focus:ring-0 p-0 text-sm ${getItemStatusColor(item)}`}
                  />
                  <div className="flex gap-1.5 mt-0.5">
                    <span
                      className="text-[9px] uppercase tracking-wider font-semibold text-gray-500 bg-black/20 px-1 py-0.5 rounded border border-white/5 cursor-pointer"
                      onClick={() => cycleType(index)}
                    >
                      {item.type}
                    </span>
                    {item.status && (
                      <span className="text-[9px] uppercase tracking-wider font-semibold text-gray-500 bg-black/20 px-1 py-0.5 rounded border border-white/5">
                        {item.status}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteItem(index)}
                  className="text-gray-500 hover:text-red-400 transition-colors shrink-0 p-1"
                >
                  <Trash className="text-sm" weight="bold" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500">
            <ListChecks className="text-3xl mx-auto mb-2 opacity-50" weight="bold" />
            <p className="text-sm">No items found for this date</p>
            <p className="text-xs mt-1">Scan a page to get started!</p>
          </div>
        )}
      </section>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 bg-dark-card border border-dark-border shadow-2xl rounded-full px-6 py-3 flex items-center gap-3 z-50 transition-transform duration-300 translate-y-0`}
        >
          {toast.type === 'error' ? (
            <WarningCircle className="text-red-500 text-xl" weight="fill" />
          ) : toast.type === 'success' ? (
            <CheckCircle className="text-green-500 text-xl" weight="fill" />
          ) : (
            <CheckCircle className="text-brand-400 text-xl" weight="fill" />
          )}
          <span className="text-sm font-medium text-gray-200">{toast.message}</span>
        </div>
      )}
    </div>
  )
}
