// Global variables
let video;
let stream;
let faceDetectionNet;
let faceDetector;
let labeledFaceDescriptors;
let faceMatcher;
let attendanceData = [];
let isProcessing = false;

const employees = [
    'Amriou_Abdelkader',
    'Azzawi_Hadj',
    'Bekafla_Kheira',
    'Bouaka_Baghdadi',
    'Khilouf_Omar_Farouk',
    'Mahari_Marouane',
    'Mekawi_Belaid',
    'Mokadem_Mohamed_Amine',
    'Sahraoui_Cherif_Eddine',
    'Saidi_Mohamed',
    'Toutai_Hamza'
];

// Browser support check
function checkBrowserSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showError('متصفحك لا يدعم الوصول إلى الكاميرا. الرجاء استخدام متصفح حديث.');
        return false;
    }
    return true;
}

// System initialization
async function initializeSystem() {
    try {
        showLoading(true);
        // Load face-api.js models
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri('models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('models')
        ]);

        video = document.getElementById('video');
        
        // Load and process employee face descriptors
        await loadEmployeeFaces();
        
        showLoading(false);
        showSuccess('تم تهيئة النظام بنجاح');
    } catch (error) {
        console.error(error);
        showError('حدث خطأ أثناء تهيئة النظام: ' + error.message);
        showLoading(false);
    }
}

// Load employee faces and create face descriptors
async function loadEmployeeFaces() {
    try {
        const labeledDescriptors = await Promise.all(
            employees.map(async employee => {
                const descriptors = [];
                const img = await faceapi.fetchImage(`images/${employee}.jpg`);
                const detection = await faceapi.detectSingleFace(img)
                    .withFaceLandmarks()
                    .withFaceDescriptor();
                
                if (detection) {
                    descriptors.push(detection.descriptor);
                }
                
                return new faceapi.LabeledFaceDescriptors(
                    employee.replace(/_/g, ' '),
                    descriptors
                );
            })
        );
        
        labeledFaceDescriptors = labeledDescriptors.filter(desc => desc.descriptors.length > 0);
        faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.6);
    } catch (error) {
        throw new Error('فشل في تحميل صور الموظفين: ' + error.message);
    }
}

// Start attendance process
async function startAttendance(type) {
    if (isProcessing) return;
    
    if (!checkBrowserSupport()) return;
    
    try {
        disableButtons(true);
        await startCamera();
        startCountdown();
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for countdown
        await processAttendance(type);
    } catch (error) {
        showError('حدث خطأ أثناء بدء عملية التسجيل: ' + error.message);
        stopCamera();
        disableButtons(false);
    }
}

// Countdown timer
function startCountdown() {
    let countdown = 5;
    const countdownElement = document.getElementById('countdown');
    countdownElement.style.display = 'block';
    
    const timer = setInterval(() => {
        countdownElement.textContent = countdown;
        countdown--;
        
        if (countdown < 0) {
            clearInterval(timer);
            countdownElement.style.display = 'none';
        }
    }, 1000);
}

// Start camera
async function startCamera() {
    try {
        // Try to get the back camera first for better face detection
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'user' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        });
        
        video.srcObject = stream;
        video.setAttribute('playsinline', ''); // Important for iOS
        await video.play();
        
        // Add face detection canvas
        const canvas = faceapi.createCanvasFromMedia(video);
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        document.querySelector('.video-container').append(canvas);
        
        // Set canvas size to match video
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
        
        // Add camera switch button if multiple cameras are available
        if ((await navigator.mediaDevices.enumerateDevices())
            .filter(device => device.kind === 'videoinput').length > 1) {
            addCameraSwitchButton();
        }
    } catch (error) {
        throw new Error('فشل في الوصول إلى الكاميرا: ' + error.message);
    }
}

// Add camera switch button
function addCameraSwitchButton() {
    let switchButton = document.getElementById('switchCamera');
    if (!switchButton) {
        switchButton = document.createElement('button');
        switchButton.id = 'switchCamera';
        switchButton.className = 'btn btn-secondary camera-switch';
        switchButton.innerHTML = 'تبديل الكاميرا';
        switchButton.onclick = switchCamera;
        document.querySelector('.video-container').appendChild(switchButton);
    }
}

// Switch between front and back cameras
async function switchCamera() {
    const currentFacingMode = stream.getVideoTracks()[0].getSettings().facingMode;
    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    // Stop current stream
    stopCamera();
    
    // Start new stream with different camera
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { exact: newFacingMode },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        });
        
        video.srcObject = stream;
        await video.play();
        
        // Recreate canvas with new video source
        const canvas = faceapi.createCanvasFromMedia(video);
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        document.querySelector('.video-container').append(canvas);
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);
    } catch (error) {
        showError('فشل في تبديل الكاميرا: ' + error.message);
        // Try to fallback to any available camera
        startCamera();
    }
}

// Process attendance
async function processAttendance(type) {
    if (!video || !stream) return;
    
    isProcessing = true;
    showLoading(true);
    
    try {
        const detections = await faceapi.detectAllFaces(video)
            .withFaceLandmarks()
            .withFaceDescriptors();
            
        if (!detections.length) {
            throw new Error('لم يتم العثور على وجه في الصورة');
        }
        
        const detection = detections[0]; // Use the first face detected
        const match = faceMatcher.findBestMatch(detection.descriptor);
        
        if (match.distance > 0.6) {
            throw new Error('لم يتم التعرف على الموظف');
        }
        
        const employee = match.label;
        const period = new Date().toLocaleTimeString('ar-SA');
        
        if (await validateAttendanceRecord(employee, period, type)) {
            attendanceData.push({
                employee,
                time: period,
                type,
                date: new Date().toLocaleDateString('ar-SA')
            });
            
            saveAttendanceData();
            updateAttendanceTable();
            showSuccess(`تم تسجيل ${type === 'in' ? 'الدخول' : 'الخروج'} للموظف ${employee} بنجاح`);
        }
    } catch (error) {
        showError(error.message);
    } finally {
        stopCamera();
        showLoading(false);
        isProcessing = false;
        disableButtons(false);
    }
}

// Validate attendance record
function validateAttendanceRecord(employee, period, type) {
    const today = new Date().toLocaleDateString('ar-SA');
    
    // Check for duplicate entries
    const lastRecord = attendanceData.find(record => 
        record.employee === employee && 
        record.type === type && 
        record.date === today
    );
    
    if (lastRecord) {
        throw new Error(`تم تسجيل ${type === 'in' ? 'الدخول' : 'الخروج'} مسبقاً اليوم للموظف ${employee}`);
    }
    
    return true;
}

// Update attendance table
function updateAttendanceTable() {
    const tableBody = document.querySelector('#attendanceTable tbody');
    tableBody.innerHTML = '';
    
    // Sort by date and time, most recent first
    const sortedData = [...attendanceData].sort((a, b) => {
        const dateA = new Date(a.date + ' ' + a.time);
        const dateB = new Date(b.date + ' ' + b.time);
        return dateB - dateA;
    });
    
    sortedData.forEach((record, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${record.employee}</td>
            <td>${record.date}</td>
            <td>${record.time}</td>
            <td>${record.type === 'in' ? 'دخول' : 'خروج'}</td>
        `;
        tableBody.appendChild(row);
    });
}

// Export to Excel
function exportToExcel() {
    if (attendanceData.length === 0) {
        showError('لا توجد بيانات للتصدير');
        return;
    }
    
    try {
        // Format data for export
        const exportData = attendanceData.map(record => ({
            'الموظف': record.employee,
            'التاريخ': record.date,
            'الوقت': record.time,
            'النوع': record.type === 'in' ? 'دخول' : 'خروج'
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
        
        // Generate filename with current date
        const date = new Date().toLocaleDateString('ar-SA').replace(/\//g, '-');
        const filename = `attendance_${date}.xlsx`;
        
        XLSX.writeFile(workbook, filename);
        showSuccess('تم تصدير البيانات بنجاح');
    } catch (error) {
        showError('حدث خطأ أثناء التصدير: ' + error.message);
    }
}

// Stop camera
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    
    if (video) {
        video.srcObject = null;
    }
    
    // Remove face detection canvas if it exists
    const canvas = document.querySelector('.video-container canvas');
    if (canvas) canvas.remove();
}

// UI helper functions
function showLoading(show) {
    const loading = document.querySelector('.loading');
    loading.style.display = show ? 'flex' : 'none';
}

function showError(message) {
    const errorElement = document.querySelector('.error-message');
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    setTimeout(() => {
        errorElement.style.display = 'none';
    }, 5000);
}

function showSuccess(message) {
    const successElement = document.querySelector('.success-message');
    successElement.textContent = message;
    successElement.style.display = 'block';
    setTimeout(() => {
        successElement.style.display = 'none';
    }, 3000);
}

function disableButtons(disabled) {
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => button.disabled = disabled);
}

// Local storage functions
function saveAttendanceData() {
    localStorage.setItem('attendanceData', JSON.stringify(attendanceData));
}

function loadAttendanceData() {
    const savedData = localStorage.getItem('attendanceData');
    if (savedData) {
        attendanceData = JSON.parse(savedData);
        updateAttendanceTable();
    }
}

// Initialize on page load
window.addEventListener('load', async () => {
    loadAttendanceData();
    await initializeSystem();
});
