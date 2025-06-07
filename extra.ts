import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

interface TextSettings {
  content: string;
  fontSize: number;
  rotation: number;
  alignment: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

class VideoEditor {
  private ffmpeg: FFmpeg;
  private videoFile: File | null = null;
  private videoElement: HTMLVideoElement;
  private textOverlay: HTMLElement;
  private textContent: HTMLElement;
  private isFFmpegLoaded = false;
  private isDragging = false;
  private isResizing = false;
  private resizeHandle = '';
  private dragOffset = { x: 0, y: 0 };
  private initialMousePos = { x: 0, y: 0 };
  private initialElementRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor() {
    this.ffmpeg = new FFmpeg();
    this.videoElement = document.getElementById('videoPreview') as HTMLVideoElement;
    this.textOverlay = document.getElementById('textOverlay') as HTMLElement;
    this.textContent = document.getElementById('textContent') as HTMLElement;
    
    this.setupEventListeners();
    this.loadFFmpeg();
  }

  private async loadFFmpeg() {
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      this.ffmpeg.on('log', ({ message }) => {
        console.log('FFmpeg:', message);
      });
      
      this.ffmpeg.on('progress', ({ progress, time }) => {
        this.updateProgress(progress);
      });

      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      this.isFFmpegLoaded = true;
      console.log('FFmpeg loaded successfully');
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
    }
  }

  private setupEventListeners() {
    // Video upload
    const videoInput = document.getElementById('videoInput') as HTMLInputElement;
    const uploadArea = document.getElementById('uploadArea') as HTMLElement;

    videoInput.addEventListener('change', (e) => this.handleVideoUpload(e));
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#ffffff';
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.style.borderColor = '#66ccff';
    });
    
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#66ccff';
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.loadVideo(files[0]);
      }
    });

    // Text controls
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const fontSize = document.getElementById('fontSize') as HTMLInputElement;
    const fontSizeValue = document.getElementById('fontSizeValue') as HTMLElement;
    const rotation = document.getElementById('rotation') as HTMLInputElement;
    const alignButtons = document.querySelectorAll('.align-btn');

    textInput.addEventListener('input', () => this.updateText());
    fontSize.addEventListener('input', () => {
      fontSizeValue.textContent = fontSize.value + 'px';
      this.updateTextStyle();
    });
    rotation.addEventListener('input', () => this.updateTextStyle());
    
    alignButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        alignButtons.forEach(b => b.classList.remove('active'));
        (e.target as HTMLElement).classList.add('active');
        this.updateTextStyle();
      });
    });

    // Video selection dropdown
    const videoSelect = document.getElementById('videoSelect') as HTMLSelectElement;
    videoSelect.addEventListener('change', () => this.updateSelectedTextPreview());

    // Export button
    const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
    exportBtn.addEventListener('click', () => this.exportVideos());

    // Text overlay drag and resize
    this.setupTextOverlayInteraction();
  }

  private setupTextOverlayInteraction() {
    // Dragging
    this.textOverlay.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
      
      this.isDragging = true;
      const rect = this.textOverlay.getBoundingClientRect();
      const containerRect = this.videoElement.getBoundingClientRect();
      
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      
      e.preventDefault();
    });

    // Resizing
    const resizeHandles = this.textOverlay.querySelectorAll('.resize-handle');
    resizeHandles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        this.isResizing = true;
        this.resizeHandle = (e.target as HTMLElement).classList[1]; // nw, ne, sw, se
        
        const rect = this.textOverlay.getBoundingClientRect();
        this.initialMousePos = { x: e.clientX, y: e.clientY };
        this.initialElementRect = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        };
        
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Mouse move and up events
    document.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.handleDrag(e);
      } else if (this.isResizing) {
        this.handleResize(e);
      }
    });

    document.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.isResizing = false;
    });
  }

  private handleDrag(e: MouseEvent) {
    const containerRect = this.videoElement.getBoundingClientRect();
    const overlayRect = this.textOverlay.getBoundingClientRect();
    
    let newX = e.clientX - this.dragOffset.x - containerRect.left;
    let newY = e.clientY - this.dragOffset.y - containerRect.top;
    
    // Constrain to video bounds
    newX = Math.max(0, Math.min(newX, containerRect.width - overlayRect.width));
    newY = Math.max(0, Math.min(newY, containerRect.height - overlayRect.height));
    
    this.textOverlay.style.left = newX + 'px';
    this.textOverlay.style.top = newY + 'px';
  }

  private handleResize(e: MouseEvent) {
    const deltaX = e.clientX - this.initialMousePos.x;
    const deltaY = e.clientY - this.initialMousePos.y;
    
    let newWidth = this.initialElementRect.width;
    let newHeight = this.initialElementRect.height;
    let newX = parseInt(this.textOverlay.style.left) || 0;
    let newY = parseInt(this.textOverlay.style.top) || 0;
    
    switch (this.resizeHandle) {
      case 'se': // bottom-right
        newWidth += deltaX;
        newHeight += deltaY;
        break;
      case 'sw': // bottom-left
        newWidth -= deltaX;
        newHeight += deltaY;
        newX += deltaX;
        break;
      case 'ne': // top-right
        newWidth += deltaX;
        newHeight -= deltaY;
        newY += deltaY;
        break;
      case 'nw': // top-left
        newWidth -= deltaX;
        newHeight -= deltaY;
        newX += deltaX;
        newY += deltaY;
        break;
    }
    
    // Minimum size constraints
    newWidth = Math.max(50, newWidth);
    newHeight = Math.max(30, newHeight);
    
    this.textOverlay.style.width = newWidth + 'px';
    this.textOverlay.style.height = newHeight + 'px';
    this.textOverlay.style.left = newX + 'px';
    this.textOverlay.style.top = newY + 'px';
  }

  private handleVideoUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.loadVideo(input.files[0]);
    }
  }

  private loadVideo(file: File) {
    this.videoFile = file;
    const url = URL.createObjectURL(file);
    
    this.videoElement.src = url;
    this.videoElement.onloadedmetadata = () => {
      this.adjustVideoAspectRatio();
      this.showSections(['previewSection', 'controlsSection', 'exportSection']);
    };
  }

  private adjustVideoAspectRatio() {
    const video = this.videoElement;
    const container = video.parentElement as HTMLElement;
    
    // Set max width and calculate proportional height
    const maxWidth = Math.min(800, window.innerWidth - 40);
    const aspectRatio = video.videoHeight / video.videoWidth;
    
    video.style.width = maxWidth + 'px';
    video.style.height = (maxWidth * aspectRatio) + 'px';
    
    // Center the container
    container.style.textAlign = 'center';
  }

  private showSections(sectionIds: string[]) {
    sectionIds.forEach(id => {
      const section = document.getElementById(id);
      if (section) {
        section.style.display = 'block';
      }
    });
  }

  private updateText() {
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const text = textInput.value || 'Sample Text';
    
    this.textContent.textContent = text;
    this.updateVideoCount();
    this.updateTextStyle();
  }

  private updateTextStyle() {
    const fontSize = (document.getElementById('fontSize') as HTMLInputElement).value;
    const rotation = (document.getElementById('rotation') as HTMLInputElement).value;
    const activeAlign = document.querySelector('.align-btn.active') as HTMLElement;
    const alignment = activeAlign?.dataset.align || 'left';
    
    this.textContent.style.fontSize = fontSize + 'px';
    this.textContent.style.textAlign = alignment;
    this.textOverlay.style.transform = `rotate(${rotation}deg)`;
  }

  private updateVideoCount() {
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const texts = this.splitTextIntoSegments(textInput.value);
    
    const countElement = document.getElementById('videoCount') as HTMLElement;
    const selectElement = document.getElementById('videoSelect') as HTMLSelectElement;
    
    countElement.textContent = texts.length.toString();
    
    // Update dropdown options
    selectElement.innerHTML = '';
    texts.forEach((text, index) => {
      const option = document.createElement('option');
      option.value = index.toString();
      option.textContent = `Video ${index + 1}`;
      selectElement.appendChild(option);
    });
    
    this.updateSelectedTextPreview();
  }

  private updateSelectedTextPreview() {
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const selectElement = document.getElementById('videoSelect') as HTMLSelectElement;
    const selectedTextElement = document.getElementById('selectedText') as HTMLElement;
    
    const texts = this.splitTextIntoSegments(textInput.value);
    const selectedIndex = parseInt(selectElement.value) || 0;
    
    selectedTextElement.textContent = texts[selectedIndex] || '';
  }

  private splitTextIntoSegments(text: string): string[] {
    return text.split('..').map(segment => segment.trim()).filter(segment => segment.length > 0);
  }

  private getTextSettings(): TextSettings {
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const fontSize = parseInt((document.getElementById('fontSize') as HTMLInputElement).value);
    const rotation = parseInt((document.getElementById('rotation') as HTMLInputElement).value);
    const activeAlign = document.querySelector('.align-btn.active') as HTMLElement;
    const alignment = activeAlign?.dataset.align || 'left';
    
    const overlayRect = this.textOverlay.getBoundingClientRect();
    const videoRect = this.videoElement.getBoundingClientRect();
    
    // Calculate relative positions
    const x = (overlayRect.left - videoRect.left) / videoRect.width;
    const y = (overlayRect.top - videoRect.top) / videoRect.height;
    const width = overlayRect.width / videoRect.width;
    const height = overlayRect.height / videoRect.height;
    
    return {
      content: textInput.value,
      fontSize,
      rotation,
      alignment,
      x,
      y,
      width,
      height
    };
  }

  private async exportVideos() {
    if (!this.isFFmpegLoaded || !this.videoFile) {
      alert('FFmpeg not loaded or no video file selected');
      return;
    }

    const settings = this.getTextSettings();
    const textSegments = this.splitTextIntoSegments(settings.content);
    
    if (textSegments.length === 0) {
      alert('No text segments found');
      return;
    }

    const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
    const progressContainer = document.getElementById('progressContainer') as HTMLElement;
    const downloadSection = document.getElementById('downloadSection') as HTMLElement;
    const downloadLinks = document.getElementById('downloadLinks') as HTMLElement;
    
    exportBtn.disabled = true;
    progressContainer.style.display = 'block';
    downloadSection.style.display = 'none';
    downloadLinks.innerHTML = '';

    try {
      // Write input video file
      await this.ffmpeg.writeFile('input.mp4', await fetchFile(this.videoFile));

      for (let i = 0; i < textSegments.length; i++) {
        const segmentText = textSegments[i];
        const outputName = `output_${i + 1}.mp4`;
        
        this.updateProgressText(`Processing video ${i + 1} of ${textSegments.length}...`);
        
        await this.processVideoWithText(segmentText, settings, outputName);
        
        // Create download link
        const data = await this.ffmpeg.readFile(outputName);
        const blob = new Blob([data], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `video_${i + 1}.mp4`;
        link.className = 'download-link';
        link.textContent = `📹 Download Video ${i + 1}`;
        downloadLinks.appendChild(link);
      }
      
      downloadSection.style.display = 'block';
      this.updateProgressText('All videos processed successfully!');
      
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      exportBtn.disabled = false;
      progressContainer.style.display = 'none';
    }
  }

  private async processVideoWithText(text: string, settings: TextSettings, outputName: string) {
    // Calculate position and size for FFmpeg
    const videoWidth = this.videoElement.videoWidth;
    const videoHeight = this.videoElement.videoHeight;
    
    const x = Math.round(settings.x * videoWidth);
    const y = Math.round(settings.y * videoHeight);
    const boxWidth = Math.round(settings.width * videoWidth);
    const boxHeight = Math.round(settings.height * videoHeight);
    
    // Escape text for FFmpeg
    const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    // Build drawtext filter
    let drawTextFilter = `drawtext=text='${escapedText}':`;
    drawTextFilter += `fontfile=/System/Library/Fonts/Arial.ttf:`;
    drawTextFilter += `fontsize=${settings.fontSize}:`;
    drawTextFilter += `fontcolor=white:`;
    drawTextFilter += `borderw=2:bordercolor=black:`;
    drawTextFilter += `x=${x}:y=${y}:`;
    
    // Text alignment
    if (settings.alignment === 'center') {
      drawTextFilter += `text_align=center:`;
    } else if (settings.alignment === 'right') {
      drawTextFilter += `text_align=right:`;
    }
    
    // Add rotation if needed
    if (settings.rotation !== 0) {
      drawTextFilter += `angle=${settings.rotation * Math.PI / 180}:`;
    }
    
    // Remove trailing colon
    drawTextFilter = drawTextFilter.replace(/:$/, '');
    
    await this.ffmpeg.exec([
      '-i', 'input.mp4',
      '-vf', drawTextFilter,
      '-c:a', 'copy',
      '-y',
      outputName
    ]);
  }

  private updateProgress(progress: number) {
    const progressFill = document.getElementById('progressFill') as HTMLElement;
    progressFill.style.width = (progress * 100) + '%';
  }

  private updateProgressText(text: string) {
    const progressText = document.getElementById('progressText') as HTMLElement;
    progressText.textContent = text;
  }
}

export function setupVideoEditor() {
  new VideoEditor();
}
