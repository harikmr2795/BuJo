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
  Calendar,
  PaperPlaneTilt,
  ChartBar,
  TrendUp,
  Fire
} from '@phosphor-icons/react'

interface BuJoItem {
  type: 'TASK' | 'EVENT' | 'NOTE'
  status: 'TODO' | 'DONE' | 'IN_PROGRESS' | 'SCHEDULED' | null
  content: string
  subtasks?: BuJoItem[]
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

  // Query state
  const [query, setQuery] = useState<string>('')
  const [queryResponse, setQueryResponse] = useState<string | null>(null)
  const [isQuerying, setIsQuerying] = useState(false)

  // Analytics state
  const [analytics, setAnalytics] = useState<any>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [calendarDate, setCalendarDate] = useState(new Date())

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

  // Load analytics data
  const loadAnalytics = useCallback(async () => {
    setLoadingAnalytics(true)
    try {
      const response = await fetch('http://localhost:8000/api/analytics')
      if (response.ok) {
        const data = await response.json()
        setAnalytics(data)
      }
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoadingAnalytics(false)
    }
  }, [])

  // Initialize: load dates, current date items, and analytics
  useEffect(() => {
    loadAvailableDates()
    loadDateItems(selectedDate)
    loadAnalytics()
  }, [selectedDate, loadAvailableDates, loadDateItems, loadAnalytics])

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

      // Reload dates, items, and analytics after successful scan
      await loadAvailableDates()
      if (data.date) {
        setSelectedDate(data.date)
        await loadDateItems(data.date)
      }
      await loadAnalytics()

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
  }, [imageFile, showToast, loadAvailableDates, loadDateItems, loadAnalytics, removeImage])

  const handleQuery = useCallback(async () => {
    if (!query.trim()) {
      showToast('Please enter a question', 'error')
      return
    }

    setIsQuerying(true)
    setQueryResponse(null)

    try {
      const response = await fetch('http://localhost:8000/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: query }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to query documents')
      }

      const data = await response.json()
      setQueryResponse(data.response)
      showToast('Query completed successfully', 'success')
    } catch (error: any) {
      console.error(error)
      showToast(`Error querying: ${error.message}`, 'error')
    } finally {
      setIsQuerying(false)
    }
  }, [query, showToast])

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

  // Group items by type and status for JIRA-style board
  const groupItemsByTypeAndStatus = useCallback(() => {
    const grouped: Record<string, Record<string, Array<{ item: BuJoItem; originalIndex: number }>>> = {
      TASK: { TODO: [], IN_PROGRESS: [], DONE: [], SCHEDULED: [] },
      EVENT: { TODO: [], IN_PROGRESS: [], DONE: [], SCHEDULED: [] },
      NOTE: { TODO: [], IN_PROGRESS: [], DONE: [], SCHEDULED: [] }
    }

    dbItems.forEach((item, index) => {
      const type = item.type || 'NOTE'
      // For NOTES, use TODO as default status if no status is set
      // For other types, use their status or default to TODO
      let status = item.status || 'TODO'

      // If it's a NOTE and has no status, put it in TODO column
      if (type === 'NOTE' && !item.status) {
        status = 'TODO'
      }

      if (!grouped[type]) grouped[type] = {}
      if (!grouped[type][status]) grouped[type][status] = []
      grouped[type][status].push({ item, originalIndex: index })
    })

    return grouped
  }, [dbItems])

  const hasPrevious = availableDates.length > 0 && availableDates.indexOf(selectedDate) > 0
  const hasNext = availableDates.length > 0 && availableDates.indexOf(selectedDate) < availableDates.length - 1
  const dateExists = availableDates.includes(selectedDate)

  const statusOrder = ['TODO', 'IN_PROGRESS', 'SCHEDULED', 'DONE']
  const typeOrder = ['TASK', 'EVENT', 'NOTE']

  return (
    <div className="relative z-10 max-w-[95vw] mx-auto px-2 py-2 md:py-3">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-brand-500/10 blur-[120px]"></div>
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px]"></div>
      </div>

      {/* Compact Header */}
      <header className="mb-2 text-center">
        <div className="inline-flex items-center justify-center gap-2">
          <div className="inline-flex items-center justify-center p-1.5 rounded-xl bg-brand-500/10 border border-brand-500/20">
            <Notebook className="text-xl text-brand-400" weight="bold" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-400 tracking-tight">
            BuJo Companion
          </h1>
        </div>
      </header>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-[3.5fr_6.5fr] gap-2">
        {/* Left Column - Scanner/Query and Dashboard */}
        <div className="space-y-2">
          {/* Scanner and Query Section */}
          <section className="glass-card p-2 md:p-3 rounded-xl space-y-2">
            {/* Unified Box - File Upload and Query Input Combined */}
            <div
              className="border-2 border-dashed border-dark-border hover:border-brand-500/50 transition-colors rounded-xl p-3 bg-dark-card/50"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div className="flex flex-col md:flex-row gap-3 items-center">
                {/* File Upload Section - Smaller */}
                <div
                  className="flex items-center gap-2 cursor-pointer group shrink-0 md:w-auto"
                  onClick={() => fileInputRef.current?.click()}
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
                      <div className="w-8 h-8 rounded-full bg-dark-card border border-dark-border flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                        <Camera className="text-lg text-gray-400 group-hover:text-brand-400 transition-colors" weight="bold" />
                      </div>
                      <div className="min-w-0 hidden sm:block">
                        <p className="text-xs font-medium text-gray-200">Scan Page</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-dark-card shrink-0 relative group/preview">
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeImage()
                          }}
                          className="absolute inset-0 bg-black/60 hover:bg-red-500/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                        >
                          <X className="text-white text-xs" weight="bold" />
                        </button>
                      </div>
                      {imagePreview && !isProcessing && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            processImage()
                          }}
                          className="btn-primary text-xs py-1.5 px-3 shrink-0"
                        >
                          <MagicWand className="mr-1.5" weight="bold" />
                          Extract
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="hidden md:block w-px h-8 bg-dark-border shrink-0"></div>

                {/* Query Input Section - Larger */}
                <div className="flex items-center gap-2 flex-[2] min-w-0 w-full md:w-auto">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !isQuerying) {
                        e.preventDefault()
                        handleQuery()
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Ask a question about your bullet journal entries..."
                    className="flex-1 bg-transparent border-none outline-none text-sm text-gray-200 placeholder:text-gray-500"
                    disabled={isQuerying}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleQuery()
                    }}
                    disabled={isQuerying || !query.trim()}
                    className="btn-primary text-sm py-2 px-4 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isQuerying ? (
                      <>
                        <CircleHalf className="mr-2 animate-spin" weight="bold" />
                        Querying...
                      </>
                    ) : (
                      <>
                        <PaperPlaneTilt className="mr-2" weight="bold" />
                        Send
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Processing State */}
            {isProcessing && (
              <div className="space-y-1">
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

            {/* Query Response */}
            {queryResponse && (
              <div className="p-4 rounded-xl bg-dark-card/60 border border-dark-border/50 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-brand-500/20 scrollbar-track-transparent">
                <div
                  className="text-sm text-gray-200 leading-tight [&_p]:mb-1 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-white [&_em]:italic [&_code]:bg-dark-card/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[10px] [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:mb-1 [&_li]:mb-0.5"
                  dangerouslySetInnerHTML={{ __html: queryResponse }}
                />
              </div>
            )}
          </section>

          {/* Dashboard Section */}
          <section className="glass-card p-2 md:p-3 rounded-xl space-y-2">
            <div className="flex items-center gap-1.5 mb-2">
              <ChartBar className="text-brand-400 text-base" weight="bold" />
              <h2 className="text-sm font-bold text-gray-200">Analytics</h2>
            </div>

            {loadingAnalytics ? (
              <div className="text-center py-4 text-gray-400 text-xs">Loading...</div>
            ) : analytics ? (
              <>
                {/* Key Metrics Cards */}
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="p-1.5 rounded-lg bg-dark-card/50 border border-dark-border/50">
                    <div className="text-[10px] text-gray-400 mb-0.5">Completion</div>
                    <div className="text-lg font-bold text-brand-400">{analytics.completion_rate}%</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{analytics.completed_tasks}/{analytics.total_tasks}</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-dark-card/50 border border-dark-border/50">
                    <div className="text-[10px] text-gray-400 mb-0.5">Total Items</div>
                    <div className="text-lg font-bold text-purple-400">{analytics.total_items}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">entries</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-dark-card/50 border border-dark-border/50">
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5">
                      <Fire className="text-orange-400 text-xs" weight="fill" />
                      Streak
                    </div>
                    <div className="text-lg font-bold text-orange-400">{analytics.current_streak}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">days</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-dark-card/50 border border-dark-border/50">
                    <div className="text-[10px] text-gray-400 mb-0.5">Active Days</div>
                    <div className="text-lg font-bold text-green-400">{analytics.active_days}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">total</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Activity Calendar */}
                  <div className="p-3 rounded-lg bg-dark-card/30 border border-dark-border/50">
                    <div className="flex items-center justify-between mb-4">
                      <button
                        onClick={() => {
                          const newDate = new Date(calendarDate)
                          newDate.setMonth(newDate.getMonth() - 1)
                          setCalendarDate(newDate)
                        }}
                        className="p-1 hover:bg-dark-border rounded-lg transition-colors"
                      >
                        <CaretLeft className="text-gray-400" />
                      </button>
                      <span className="text-xs font-bold text-gray-200 truncate mx-1">
                        {calendarDate.toLocaleString('default', { month: 'short', year: '2-digit' })}
                      </span>
                      <button
                        onClick={() => {
                          const newDate = new Date(calendarDate)
                          newDate.setMonth(newDate.getMonth() + 1)
                          setCalendarDate(newDate)
                        }}
                        className="p-1 hover:bg-dark-border rounded-lg transition-colors"
                      >
                        <CaretRight className="text-gray-400" />
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => (
                        <div key={day} className="text-center text-[8px] font-medium text-gray-500 uppercase">
                          {day}
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {(() => {
                        const year = calendarDate.getFullYear()
                        const month = calendarDate.getMonth()
                        const daysInMonth = new Date(year, month + 1, 0).getDate()
                        const firstDayOfMonth = new Date(year, month, 1).getDay()

                        const days = []
                        // Empty cells for days before the 1st
                        for (let i = 0; i < firstDayOfMonth; i++) {
                          days.push(<div key={`empty-${i}`} className="aspect-square" />)
                        }

                        // Productivity map
                        const productivityMap = new Map()
                        analytics.productivity_trend.forEach((item: any) => {
                          productivityMap.set(item.date, item.count)
                        })

                        const maxCount = Math.max(...analytics.productivity_trend.map((i: any) => i.count), 5) * 1.2

                        for (let day = 1; day <= daysInMonth; day++) {
                          const dateObj = new Date(year, month, day)
                          const dateStr = `${String(day).padStart(2, '0')}-${String(month + 1).padStart(2, '0')}-${year}`
                          const formattedForSelection = formatDate(dateObj)
                          const count = productivityMap.get(dateStr) || 0
                          const isToday = new Date().toDateString() === dateObj.toDateString()
                          const isSelected = selectedDate === formattedForSelection

                          days.push(
                            <div
                              key={day}
                              onClick={() => setSelectedDate(formattedForSelection)}
                              className={`aspect-square relative flex items-center justify-center group cursor-pointer rounded-lg transition-all z-0
                                ${isSelected ? 'bg-brand-500/20 ring-1 ring-brand-400' : 'hover:bg-dark-card/50'}
                              `}
                            >
                              {/* Circle Background - Bubble Style */}
                              {count > 0 && (
                                <div
                                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-500/20 transition-all duration-500 pointer-events-none"
                                  style={{
                                    width: `${Math.min((count / maxCount) * 150 + 50, 160)}%`,
                                    height: `${Math.min((count / maxCount) * 150 + 50, 160)}%`,
                                  }}
                                />
                              )}

                              {/* Day Number */}
                              <span className={`relative z-10 text-[10px] ${isToday ? 'text-brand-400 font-bold' : isSelected ? 'text-white font-semibold' : 'text-gray-300'} ${count > 0 ? 'font-medium' : ''}`}>
                                {day}
                              </span>

                              {/* Tooltip */}
                              {count > 0 && (
                                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/80 text-[10px] text-white rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
                                  {count} items
                                </div>
                              )}
                            </div>
                          )
                        }

                        return days
                      })()}
                    </div>
                  </div>

                  {/* Journal Insights */}
                  <div className="p-3 rounded-lg bg-dark-card/30 border border-dark-border/50 flex flex-col justify-between">
                    <div className="flex items-center gap-1.5 mb-3">
                      <TrendUp className="text-brand-400 text-sm" weight="bold" />
                      <h3 className="text-xs font-bold text-gray-200">Journal Insights</h3>
                    </div>

                    {/* Type Distribution */}
                    <div className="space-y-3 flex-1">
                      {[
                        { label: 'Tasks', type: 'TASK', color: 'bg-brand-500', text: 'text-brand-400' },
                        { label: 'Events', type: 'EVENT', color: 'bg-purple-500', text: 'text-purple-400' },
                        { label: 'Notes', type: 'NOTE', color: 'bg-yellow-500', text: 'text-yellow-400' }
                      ].map(cat => {
                        const count = analytics.type_distribution[cat.type] || 0
                        const pct = analytics.total_items > 0 ? (count / analytics.total_items) * 100 : 0
                        return (
                          <div key={cat.type} className="space-y-1">
                            <div className="flex justify-between items-end text-[10px]">
                              <span className="text-gray-400 font-medium">{cat.label}</span>
                              <div className="flex items-center gap-1">
                                <span className={`${cat.text} font-bold`}>{count}</span>
                                <span className="text-gray-600">/ {Math.round(pct)}%</span>
                              </div>
                            </div>
                            <div className="h-1.5 w-full bg-dark-card rounded-full overflow-hidden border border-dark-border/30">
                              <div
                                className={`h-full ${cat.color} rounded-full transition-all duration-500`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Busiest Day */}
                    <div className="mt-3 pt-2 border-t border-dark-border/30 flex items-center justify-between">
                      <div className="text-[10px] text-gray-500">Most Active Day</div>
                      <div className="text-xs font-bold text-white bg-dark-card px-2 py-1 rounded border border-dark-border">
                        {analytics.total_items > 0
                          ? Object.entries(analytics.items_by_day_of_week as Record<string, number>).reduce((a, b) => a[1] >= b[1] ? a : b)[0]
                          : 'No data'}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-4 text-gray-400 text-xs">No data</div>
            )}
          </section>
        </div>

        {/* Right Column - Date Navigation and Items */}
        <div>
          <section className="glass-card p-2 md:p-3 rounded-xl">
            {/* Date Navigation */}
            <div className="flex items-center justify-between mb-1.5">
              <button
                onClick={navigatePrevious}
                disabled={availableDates.length === 0}
                className="p-0.5 rounded-lg bg-dark-card hover:bg-dark-border border border-dark-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <CaretLeft className="text-sm text-gray-300" weight="bold" />
              </button>

              <div className="flex items-center gap-1.5 flex-1 justify-center">
                <Calendar className="text-brand-400 text-base" weight="bold" />
                <div className="text-center">
                  <div className="text-base md:text-lg font-bold text-gray-200">{selectedDate}</div>
                  {!dateExists && (
                    <div className="text-[10px] text-gray-500 mt-0.5">No data</div>
                  )}
                </div>
              </div>

              <button
                onClick={navigateNext}
                disabled={availableDates.length === 0}
                className="p-0.5 rounded-lg bg-dark-card hover:bg-dark-border border border-dark-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <CaretRight className="text-sm text-gray-300" weight="bold" />
              </button>
            </div>

            {/* Items Board - Side by Side Layout */}
            {loadingDate ? (
              <div className="text-center py-2 text-gray-400 text-xs">Loading...</div>
            ) : dbItems.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {(() => {
                  const grouped = groupItemsByTypeAndStatus()

                  return typeOrder.map((type) => {
                    const typeItems = grouped[type] || {}
                    const totalItems = statusOrder.reduce((sum, status) => sum + (typeItems[status]?.length || 0), 0)

                    // Determine relevant statuses for each type
                    const relevantStatuses = type === 'TASK'
                      ? ['TODO', 'IN_PROGRESS', 'DONE']
                      : type === 'EVENT'
                        ? ['SCHEDULED', 'DONE']
                        : ['TODO'] // NOTES

                    return (
                      <div key={type} className="flex flex-col space-y-1.5">
                        {/* Category Header - Most Prominent */}
                        <div className="px-2 py-1.5 rounded-lg bg-gradient-to-r from-brand-500/20 to-purple-500/20 border-2 border-brand-500/30 shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-white">
                              {type}S
                            </span>
                            <span className="text-[10px] font-semibold text-gray-200 bg-brand-500/30 px-1.5 py-0.5 rounded-full border border-brand-400/50">
                              {totalItems}
                            </span>
                          </div>
                        </div>

                        {/* Status Sections - Stacked Vertically */}
                        <div className="flex flex-col space-y-1.5 flex-1">
                          {relevantStatuses.map((status) => {
                            const items = typeItems[status] || []

                            // Only show status section if it has items
                            if (items.length === 0) return null

                            return (
                              <div key={status} className="flex flex-col">
                                {/* Subcategory Header - Medium Prominence - More Distinct */}
                                <div className="px-2 py-1 mb-1.5 rounded-lg bg-gradient-to-r from-dark-card/80 to-dark-card/60 border-l-4 border-brand-400/50 shadow-sm">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-200">
                                      {status.replace('_', ' ')}
                                    </span>
                                    <span className="text-[10px] font-semibold text-white bg-brand-500/40 px-1.5 py-0.5 rounded-full border border-brand-400/30">
                                      {items.length}
                                    </span>
                                  </div>
                                </div>

                                {/* Items in Status Section - Least Prominent */}
                                <div className="space-y-1 flex-1 ml-1.5">
                                  {items.map(({ item, originalIndex }) => (
                                    <div
                                      key={originalIndex}
                                      className="glass-card p-1.5 rounded-md hover:bg-dark-card/40 transition-all border border-dark-border/30 hover:border-dark-border/50"
                                    >
                                      <div className="flex items-start gap-1.5">
                                        <div className="shrink-0 cursor-pointer mt-0.5" onClick={() => type === 'NOTE' ? cycleType(originalIndex) : toggleStatus(originalIndex)}>
                                          {getItemIcon(item)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <input
                                            type="text"
                                            value={item.content || ''}
                                            onChange={(e) => updateContent(originalIndex, e.target.value)}
                                            className={`bg-transparent border-none w-full focus:ring-0 p-0 text-xs ${getItemStatusColor(item)}`}
                                            placeholder="Item content..."
                                          />
                                          {/* Subtasks */}
                                          {item.subtasks && item.subtasks.length > 0 && (
                                            <div className="mt-1 flex flex-col space-y-0.5 ml-1">
                                              {item.subtasks.map((sub, subIdx) => (
                                                <div key={subIdx} className="flex items-start gap-1.5 group/sub">
                                                  <div className="shrink-0 mt-1 w-1 h-1 rounded-full bg-gray-500"></div>
                                                  <span className={`text-[10px] text-gray-400 ${sub.status === 'DONE' ? 'line-through opacity-70' : ''}`}>
                                                    {sub.content}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => deleteItem(originalIndex)}
                                          className="text-gray-500 hover:text-red-400 transition-colors shrink-0 p-0.5"
                                        >
                                          <Trash className="text-[10px]" weight="bold" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">
                <ListChecks className="text-2xl mx-auto mb-1.5 opacity-50" weight="bold" />
                <p className="text-sm">No items found for this date</p>
                <p className="text-xs mt-1">Scan a page to get started!</p>
              </div>
            )}
          </section>
        </div>
      </div>

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
