// API configuration
let API_KEY = '';
let WEATHER_API_KEY = '';
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

let timeUpdateInterval;

// Declare DOM elements globally but assign them inside DOMContentLoaded
let searchInput, searchButton, locationElement, locationSmallElement, 
    temperatureElement, mainConditionLargeElement, timeElement, 
    humidityElement, windElement, forecastContainer, weatherIconElement, 
    hourlyForecastContainer;

// New: Dark Mode elements
let darkModeToggle, sunIcon, moonIcon;

// Add Chart.js chart variable
let weatherChart;
let hourlyData = [], dailyData = [], windData = [], precipData = [], hourlyLabels = [], dailyLabels = [];

let map;
let marker;
let weatherOverlay;

// Load API keys from config.js dynamically
async function loadApiKeys() {
    try {
        const response = await fetch('config.js');
        const text = await response.text();
        // Extract OpenWeather key
        const matchOpenWeather = text.match(/apiKey:\s*['\"]([^'\"]+)['\"]/);
        if (matchOpenWeather) {
            API_KEY = matchOpenWeather[1];
        } else {
            throw new Error('OpenWeather API key not found in config.js');
        }
        // Extract WeatherAPI.com key
        const matchWeatherApi = text.match(/weatherApiKey:\s*['\"]([^'\"]+)['\"]/);
        if (matchWeatherApi) {
            WEATHER_API_KEY = matchWeatherApi[1];
        } else {
            throw new Error('WeatherAPI.com key not found in config.js');
        }
    } catch (err) {
        console.error('Failed to load API keys:', err);
        showError('Failed to load API keys.');
    }
}

// Show severe weather alerts in the UI and as browser notifications
function showWeatherAlerts(alerts) {
    const alertDiv = document.getElementById('weatherAlerts');
    const alertContent = alertDiv.querySelector('div');
    if (alerts && alerts.length > 0) {
        alertDiv.classList.remove('hidden');
        alertContent.setAttribute('aria-live', 'assertive');
        alertContent.innerHTML = alerts.map(alert => `
            <div class="mb-2">
                <span class="font-bold">${alert.event || alert.headline || 'Alert'}:</span> 
                <span>${alert.description || alert.desc || alert.note || ''}</span>
                <span class="block text-sm text-red-300 mt-1">${alert.severity ? 'Severity: ' + alert.severity : ''}</span>
                <span class="block text-xs text-red-100 mt-1">${alert.effective ? 'From: ' + alert.effective : ''} ${alert.expires ? 'To: ' + alert.expires : ''}</span>
            </div>
        `).join('');
        // Browser notification for the first alert
        if (window.Notification && Notification.permission === 'granted') {
            new Notification(alerts[0].event || 'Severe Weather Alert', {
                body: alerts[0].description || alerts[0].desc || alerts[0].note || '',
                icon: '/favicon.ico'
            });
        } else if (window.Notification && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification(alerts[0].event || 'Severe Weather Alert', {
                        body: alerts[0].description || alerts[0].desc || alerts[0].note || '',
                        icon: '/favicon.ico'
                    });
                }
            });
        }
    } else {
        alertDiv.classList.add('hidden');
        alertContent.innerHTML = '';
    }
}

// Fetch weather data (now using One Call API for extended forecast, fallback to 5-day/3-hour forecast)
async function getWeatherData(city) {
    try {
        setLoadingState(true);
        // Get lat/lon for city
        const geoRes = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${API_KEY}`);
        if (!geoRes.ok) throw new Error('City not found');
        const geoData = await geoRes.json();
        if (!geoData[0]) throw new Error('City not found');
        const { lat, lon, name, country } = geoData[0];

        let oneCallData = null;
        let usedFallback = false;
        let alerts = [];
        // Try One Call API
        try {
            const oneCallRes = await fetch(`https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`);
            if (!oneCallRes.ok) throw new Error('One Call API not available');
            oneCallData = await oneCallRes.json();
            if (oneCallData.alerts && oneCallData.alerts.length > 0) {
                alerts = oneCallData.alerts;
            }
        } catch (err) {
            usedFallback = true;
        }

        let weatherData, forecastData;
        if (!usedFallback && oneCallData) {
            // One Call API data
            weatherData = {
                name,
                sys: { country },
                main: { temp: oneCallData.current.temp, humidity: oneCallData.current.humidity },
                weather: [oneCallData.current.weather[0]],
                wind: { speed: oneCallData.current.wind_speed },
                timezone: oneCallData.timezone_offset
            };
            forecastData = {
                list: oneCallData.hourly.slice(0, 40).map((h, i) => ({
                    dt: h.dt,
                    main: { temp: h.temp },
                    weather: [h.weather[0]],
                    wind: { speed: h.wind_speed },
                    pop: h.pop
                })),
                city: { timezone: oneCallData.timezone_offset }
            };
            // Prepare chart data
            hourlyData = oneCallData.hourly.slice(0, 48).map(h => h.temp);
            hourlyLabels = oneCallData.hourly.slice(0, 48).map(h => {
                const d = new Date(h.dt * 1000);
                return d.getHours().toString().padStart(2, '0') + ':00';
            });
            windData = oneCallData.hourly.slice(0, 48).map(h => h.wind_speed);
            precipData = oneCallData.hourly.slice(0, 48).map(h => Math.round(h.pop * 100));
            dailyData = oneCallData.daily.slice(0, 10).map(d => d.temp.day);
            dailyLabels = oneCallData.daily.slice(0, 10).map(d => {
                const date = new Date(d.dt * 1000);
                return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            });
        } else {
            // Fallback: 5-day/3-hour forecast
            const fallbackRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`);
            if (!fallbackRes.ok) throw new Error('Weather data not available');
            const fallbackData = await fallbackRes.json();
            // Use first item for current
            weatherData = {
                name,
                sys: { country },
                main: { temp: fallbackData.list[0].main.temp, humidity: fallbackData.list[0].main.humidity },
                weather: [fallbackData.list[0].weather[0]],
                wind: { speed: fallbackData.list[0].wind.speed },
                timezone: fallbackData.city.timezone
            };
            forecastData = fallbackData;
            // Prepare chart data (up to 40 x 3h = 5 days)
            hourlyData = fallbackData.list.map(h => h.main.temp);
            hourlyLabels = fallbackData.list.map(h => {
                const d = new Date(h.dt * 1000);
                return d.getHours().toString().padStart(2, '0') + ':00';
            });
            windData = fallbackData.list.map(h => h.wind.speed);
            precipData = fallbackData.list.map(h => h.pop ? Math.round(h.pop * 100) : 0);
            // For daily, group by day
            const dayMap = {};
            fallbackData.list.forEach(h => {
                const date = new Date(h.dt * 1000);
                const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                if (!dayMap[day]) dayMap[day] = [];
                dayMap[day].push(h.main.temp);
            });
            dailyLabels = Object.keys(dayMap);
            dailyData = Object.values(dayMap).map(arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length));
            // Fallback: Try WeatherAPI.com alerts if available
            if (WEATHER_API_KEY && WEATHER_API_KEY !== 'YOUR_WEATHERAPI_KEY') {
                const alertRes = await fetch(`https://api.weatherapi.com/v1/alerts.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(city)}`);
                if (alertRes.ok) {
                    const alertData = await alertRes.json();
                    if (alertData.alerts && alertData.alerts.length > 0) {
                        alerts = alertData.alerts;
                    }
                }
            }
        }

        // Show alerts if any
        showWeatherAlerts(alerts);

        updateWeatherUI(weatherData);
        updateForecastUI(forecastData);
        updateHourlyForecast(forecastData, weatherData.timezone);
        startTimeUpdate(weatherData.timezone, weatherData);
        renderWeatherChart('hourly');
    } catch (error) {
        showError(error.message);
    } finally {
        setLoadingState(false);
    }
}

function getWeatherRecommendations(condition, tempC) {
    condition = condition.toLowerCase();
    let recs = [];
    // Clothing
    if (condition.includes('rain') || condition.includes('drizzle') || condition.includes('thunderstorm')) {
        recs.push('Bring an umbrella or raincoat.');
    }
    if (condition.includes('snow')) {
        recs.push('Wear warm clothes and boots.');
    }
    if (condition.includes('clear') || condition.includes('sun')) {
        recs.push('Wear sunglasses and sunscreen.');
    }
    if (condition.includes('wind')) {
        recs.push('A windbreaker or jacket is recommended.');
    }
    // Temperature
    if (tempC <= 5) {
        recs.push('Dress in layers and wear a warm coat.');
    } else if (tempC <= 15) {
        recs.push('A light jacket or sweater is a good idea.');
    } else if (tempC >= 28) {
        recs.push('Stay hydrated and avoid strenuous outdoor activity.');
    }
    // Activities
    if (condition.includes('rain') || condition.includes('thunderstorm')) {
        recs.push('Consider indoor activities like visiting a museum or reading a book.');
    } else if (condition.includes('snow')) {
        recs.push('Great day for building a snowman or skiing!');
    } else if (condition.includes('clear') || condition.includes('sun')) {
        recs.push('Perfect for outdoor activities like hiking or a picnic.');
    }
    // Travel tips
    if (condition.includes('fog')) {
        recs.push('Drive carefully: low visibility due to fog.');
    }
    if (condition.includes('storm')) {
        recs.push('Check for travel advisories and avoid unnecessary trips.');
    }
    if (recs.length === 0) {
        recs.push('No special recommendations. Enjoy your day!');
    }
    return recs;
}

function showWeatherRecommendations(condition, tempC) {
    const recDiv = document.getElementById('weatherRecommendations');
    if (!recDiv) return;
    const recs = getWeatherRecommendations(condition, tempC);
    recDiv.innerHTML = recs.map(r => `<div class="mb-2">${r}</div>`).join('');
}

function updateWeatherUI(data) {
    locationElement.textContent = `${data.name}, ${data.sys.country}`;
    locationSmallElement.textContent = `${data.name}, ${data.sys.country}`;

    temperatureElement.forEach(el => {
        el.textContent = `${Math.round(data.main.temp)}°C`;
    });

    const mainCondition = data.weather[0].description
        ? capitalizeFirstLetter(data.weather[0].description)
        : data.weather[0].main;
    mainConditionLargeElement.textContent = mainCondition;
    weatherIconElement.forEach(el => {
        el.innerHTML = getWeatherIconSVG(data.weather[0].main, 'h-12 w-12');
    });

    humidityElement.textContent = `${data.main.humidity}%`;
    windElement.textContent = `${Math.round(data.wind.speed)} km/h`;

    // Show recommendations
    showWeatherRecommendations(data.weather[0].description || data.weather[0].main, data.main.temp);
}

function startTimeUpdate(timezoneOffset, data) {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    updateLocalTime(timezoneOffset, data);
    timeUpdateInterval = setInterval(() => {
        updateLocalTime(timezoneOffset, data);
    }, 1000);
}
function updateLocalTime(timezoneOffset, data) {
    const localTime = new Date();
    const utc = localTime.getTime() + (localTime.getTimezoneOffset() * 60000);
    const cityTime = new Date(utc + (1000 * timezoneOffset));
    const dateTimeString = cityTime.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    const tzOffset = timezoneOffset / 3600;
    const tzString = `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
    timeElement.innerHTML = `
        <div class="text-lg">${dateTimeString}</div>
        <div class="text-sm text-white/70 mt-1">${tzString}</div>
    `;
}

function updateForecastUI(data) {
    forecastContainer.innerHTML = '';
    const dailyForecasts = data.list.filter(forecast => {
        const forecastDate = new Date(forecast.dt * 1000);
        return forecastDate.getHours() === 12;
    }).slice(0, 5);
    dailyForecasts.forEach(forecast => {
        const date = new Date(forecast.dt * 1000);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const temperature = Math.round(forecast.main.temp);
        const condition = forecast.weather[0].main;
        const description = forecast.weather[0].description;
        const forecastElement = document.createElement('div');
        forecastElement.className = 'flex items-center justify-between bg-white/10 rounded-lg px-4 py-2';
        forecastElement.innerHTML = `
            <div class="flex items-center gap-2">
                ${getWeatherIconSVG(condition, 'h-6 w-6')}
                <span class="text-white/90 text-base">${dayName}</span>
                <span class="text-white/60 text-sm ml-2">${capitalizeFirstLetter(description)}</span>
            </div>
            <div class="text-white/80 text-lg font-semibold">${temperature}°C</div>
        `;
        forecastContainer.appendChild(forecastElement);
    });
}

function updateHourlyForecast(data, timezoneOffset) {
    hourlyForecastContainer.innerHTML = '';
    const now = Date.now();
    let count = 0;
    for (let i = 0; i < data.list.length && count < 10; i++) {
        const forecast = data.list[i];
        const forecastDate = new Date((forecast.dt + data.city.timezone) * 1000);
        if (forecastDate.getTime() < now) continue;
        const hour = forecastDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const temp = Math.round(forecast.main.temp);
        const condition = forecast.weather[0].main;
        const item = document.createElement('div');
        item.className = 'flex flex-col items-center bg-white/10 rounded-lg px-3 py-2 min-w-[60px]';
        item.innerHTML = `
            <span class="text-xs text-white/70 mb-1">${hour}</span>
            ${getWeatherIconSVG(condition, 'h-5 w-5')}
            <span class="text-sm text-white/90 mt-1">${temp}°C</span>
        `;
        hourlyForecastContainer.appendChild(item);
        count++;
    }
}

function getWeatherIconSVG(condition, size = 'h-8 w-8') {
    const iconMap = {
        Clear: `<svg xmlns="http://www.w3.org/2000/svg" class="${size} mx-auto my-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>`,
        Clouds: `<svg xmlns="http://www.w3.org/2000/svg" class="${size} mx-auto my-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>`,
        Rain: `<svg xmlns="http://www.w3.org/2000/svg" class="${size} mx-auto my-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>`,
        Drizzle: `<svg xmlns="http://www.w3.org/2000/svg" class="${size} mx-auto my-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9-78 2.096A4.001 4.001 0 003 15z" /><line x1="8" y1="19" x2="8" y2="21" stroke="currentColor" stroke-width="2"/><line x1="16" y1="19" x2="16" y2="21" stroke="currentColor" stroke-width="2"/></svg>`,
        Thunderstorm: `<svg xmlns="http://www.w3.org/2000/svg" class="${size} mx-auto my-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16l-4 4m0 0l4-4m-4 4V4" /></svg>`,
        Snow: `<svg xmlns="http://www.w3.org/2000/svg" class="${size} mx-auto my-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 17.58A5 5 0 0018 9h-1.26A8 8 0 103 17.58" /></svg>`,
        Mist: `<svg xmlns="http://www.w3.org/2000/svg" class="${size} mx-auto my-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h18M3 16h18M3 8h18" /></svg>`
    };
    return iconMap[condition] || iconMap['Clouds'];
}

function setLoadingState(isLoading) {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.style.display = isLoading ? 'flex' : 'none';
}

function showError(message) {
    // If offline and fetch failed, show offline fallback
    if ((message === 'Failed to fetch' || message === 'NetworkError when attempting to fetch resource.') && !navigator.onLine) {
        // Try to redirect to offline.html if not already there
        if (!window.location.pathname.endsWith('offline.html')) {
            window.location.href = 'offline.html';
            return;
        }
    }
    // Otherwise, show a non-blocking in-app error message
    let errorDiv = document.getElementById('appError');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'appError';
        errorDiv.style.position = 'fixed';
        errorDiv.style.top = '24px';
        errorDiv.style.left = '50%';
        errorDiv.style.transform = 'translateX(-50%)';
        errorDiv.style.zIndex = '9999';
        errorDiv.style.background = 'rgba(30,41,59,0.85)';
        errorDiv.style.color = '#fff';
        errorDiv.style.padding = '16px 32px';
        errorDiv.style.borderRadius = '16px';
        errorDiv.style.boxShadow = '0 4px 24px rgba(0,0,0,0.2)';
        errorDiv.style.fontSize = '1.1rem';
        errorDiv.style.fontWeight = '500';
        errorDiv.style.textAlign = 'center';
        errorDiv.style.pointerEvents = 'none';
        document.body.appendChild(errorDiv);
    }
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => { errorDiv.style.display = 'none'; }, 4000);
}

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// New: Dark Mode functions
function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-mode');
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    } else {
        document.body.classList.remove('light-mode');
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    }
    localStorage.setItem('theme', theme);
}

// Chart.js logic
function renderWeatherChart(type) {
    const ctx = document.getElementById('weatherChart').getContext('2d');
    if (weatherChart) weatherChart.destroy();
    let data, labels, label, color, extraDataset;
    if (type === 'hourly') {
        data = hourlyData;
        labels = hourlyLabels;
        label = 'Temperature (°C)';
        color = 'rgba(59,130,246,0.8)';
        extraDataset = null;
    } else if (type === 'daily') {
        data = dailyData;
        labels = dailyLabels;
        label = 'Temperature (°C)';
        color = 'rgba(16,185,129,0.8)';
        extraDataset = null;
    } else if (type === 'other') {
        data = windData;
        labels = hourlyLabels;
        label = 'Wind Speed (km/h)';
        color = 'rgba(234,179,8,0.8)';
        extraDataset = {
            label: 'Precipitation Probability (%)',
            data: precipData,
            borderColor: 'rgba(59,130,246,0.5)',
            backgroundColor: 'rgba(59,130,246,0.2)',
            type: 'bar',
            yAxisID: 'y1',
        };
    }
    weatherChart = new Chart(ctx, {
        type: type === 'other' ? 'line' : 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: label,
                    data: data,
                    borderColor: color,
                    backgroundColor: color.replace('0.8', '0.2'),
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y',
                },
                ...(extraDataset ? [extraDataset] : [])
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: true },
                tooltip: { mode: 'index', intersect: false }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: label }
                },
                y1: type === 'other' ? {
                    beginAtZero: true,
                    position: 'right',
                    title: { display: true, text: 'Precip (%)' },
                    grid: { drawOnChartArea: false }
                } : undefined
            }
        }
    });
}

// Chart tab logic
function setChartTab(active) {
    document.getElementById('chartHourlyBtn').classList.remove('forecast-tab-active');
    document.getElementById('chartDailyBtn').classList.remove('forecast-tab-active');
    document.getElementById('chartOtherBtn').classList.remove('forecast-tab-active');
    if (active === 'hourly') document.getElementById('chartHourlyBtn').classList.add('forecast-tab-active');
    if (active === 'daily') document.getElementById('chartDailyBtn').classList.add('forecast-tab-active');
    if (active === 'other') document.getElementById('chartOtherBtn').classList.add('forecast-tab-active');
}

// Historical Weather Logic
async function fetchHistoricalWeather(city, date) {
    const resultDiv = document.getElementById('historicalResult');
    resultDiv.innerHTML = '<span class="text-blue-200">Loading...</span>';
    try {
        // 1. Get lat/lon for city (OpenWeather)
        const geoRes = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${API_KEY}`);
        if (!geoRes.ok) throw new Error('City not found');
        const geoData = await geoRes.json();
        if (!geoData[0]) throw new Error('City not found');
        const { lat, lon, name, country } = geoData[0];
        // 2. Convert date to UNIX timestamp (midday UTC)
        const dt = Math.floor(new Date(date + 'T12:00:00Z').getTime() / 1000);
        // 3. Try OpenWeather historical API (paid only)
        const histRes = await fetch(`https://api.openweathermap.org/data/2.5/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${dt}&units=metric&appid=${API_KEY}`);
        if (histRes.ok) {
            const histData = await histRes.json();
            let html = `<div class="mb-2 font-semibold">Historical Weather for ${name}, ${country} on ${date}</div>`;
            if (histData.current) {
                html += `<div class="mb-2">At noon: <span class="font-bold">${histData.current.temp}°C</span>, <span class="capitalize">${histData.current.weather[0].description}</span></div>`;
            }
            if (histData.hourly && histData.hourly.length > 0) {
                html += `<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead><tr><th class="px-2">Hour</th><th class="px-2">Temp (°C)</th><th class="px-2">Weather</th></tr></thead><tbody>`;
                histData.hourly.forEach(h => {
                    const hour = new Date(h.dt * 1000).getUTCHours().toString().padStart(2, '0') + ':00';
                    html += `<tr><td class="px-2">${hour}</td><td class="px-2">${h.temp}</td><td class="px-2 capitalize">${h.weather[0].description}</td></tr>`;
                });
                html += '</tbody></table></div>';
            }
            resultDiv.innerHTML = html;
            return;
        }
        // 4. Fallback: Try WeatherAPI.com (free historical data)
        if (!WEATHER_API_KEY || WEATHER_API_KEY === 'YOUR_WEATHERAPI_KEY') {
            throw new Error('WeatherAPI.com key not set in config.js.');
        }
        const weatherApiUrl = `https://api.weatherapi.com/v1/history.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(city)}&dt=${date}`;
        const weatherApiRes = await fetch(weatherApiUrl);
        if (weatherApiRes.ok) {
            const weatherApiData = await weatherApiRes.json();
            let html = `<div class="mb-2 font-semibold">Historical Weather for ${weatherApiData.location.name}, ${weatherApiData.location.country} on ${date}</div>`;
            if (weatherApiData.forecast && weatherApiData.forecast.forecastday && weatherApiData.forecast.forecastday[0]) {
                const day = weatherApiData.forecast.forecastday[0].day;
                html += `<div class="mb-2">Avg: <span class="font-bold">${day.avgtemp_c}°C</span>, <span class="capitalize">${day.condition.text}</span></div>`;
                if (weatherApiData.forecast.forecastday[0].hour && weatherApiData.forecast.forecastday[0].hour.length > 0) {
                    html += `<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead><tr><th class="px-2">Hour</th><th class="px-2">Temp (°C)</th><th class="px-2">Weather</th></tr></thead><tbody>`;
                    weatherApiData.forecast.forecastday[0].hour.forEach(h => {
                        const hour = h.time.split(' ')[1];
                        html += `<tr><td class="px-2">${hour}</td><td class="px-2">${h.temp_c}</td><td class="px-2 capitalize">${h.condition.text}</td></tr>`;
                    });
                    html += '</tbody></table></div>';
                }
            }
            resultDiv.innerHTML = html;
            return;
        }
        throw new Error('Historical weather not available for this city/date.');
    } catch (err) {
        resultDiv.innerHTML = `<span class="text-red-300">${err.message}</span>`;
    }
}

function initMap() {
    map = L.map('weatherMap').setView([20, 0], 2); // World view
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Add OpenWeatherMap weather overlay (clouds as default)
    weatherOverlay = L.tileLayer('https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=' + API_KEY, {
        attribution: 'Weather data © OpenWeatherMap',
        opacity: 0.5
    }).addTo(map);

    // Map click event
    map.on('click', async function(e) {
        const { lat, lng } = e.latlng;
        if (marker) map.removeLayer(marker);
        marker = L.marker([lat, lng]).addTo(map);
        // Fetch weather for clicked location
        const weather = await getWeatherByCoords(lat, lng);
        if (weather) {
            marker.bindPopup(`<b>${weather.name || 'Unknown location'}</b><br>${Math.round(weather.temp)}°C, ${weather.condition}`).openPopup();
            // Update main UI with this data
            updateWeatherUIFromCoords(weather);
        } else {
            marker.bindPopup('Weather not found').openPopup();
        }
    });
}

// Fetch weather by coordinates (OpenWeather, fallback to WeatherAPI)
async function getWeatherByCoords(lat, lon) {
    try {
        // Try OpenWeather current weather
        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);
        let alerts = [];
        if (res.ok) {
            const data = await res.json();
            // Try One Call for alerts
            const oneCallRes = await fetch(`https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
            if (oneCallRes.ok) {
                const oneCallData = await oneCallRes.json();
                if (oneCallData.alerts && oneCallData.alerts.length > 0) {
                    alerts = oneCallData.alerts;
                }
            }
            showWeatherAlerts(alerts);
            return {
                name: data.name,
                country: data.sys.country,
                temp: data.main.temp,
                condition: data.weather[0].main,
                description: data.weather[0].description,
                humidity: data.main.humidity,
                wind: data.wind.speed,
                icon: data.weather[0].main,
                timezone: data.timezone
            };
        }
        // Fallback: WeatherAPI.com
        if (WEATHER_API_KEY && WEATHER_API_KEY !== 'YOUR_WEATHERAPI_KEY') {
            const res2 = await fetch(`https://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${lat},${lon}`);
            if (res2.ok) {
                const data = await res2.json();
                // Try WeatherAPI.com alerts
                const alertRes = await fetch(`https://api.weatherapi.com/v1/alerts.json?key=${WEATHER_API_KEY}&q=${lat},${lon}`);
                if (alertRes.ok) {
                    const alertData = await alertRes.json();
                    if (alertData.alerts && alertData.alerts.length > 0) {
                        alerts = alertData.alerts;
                    }
                }
                showWeatherAlerts(alerts);
                return {
                    name: data.location.name,
                    country: data.location.country,
                    temp: data.current.temp_c,
                    condition: data.current.condition.text,
                    description: data.current.condition.text,
                    humidity: data.current.humidity,
                    wind: data.current.wind_kph,
                    icon: data.current.condition.text,
                    timezone: 0 // WeatherAPI does not provide offset in current endpoint
                };
            }
        }
        showWeatherAlerts([]);
        return null;
    } catch (e) {
        showWeatherAlerts([]);
        return null;
    }
}

// Update main weather UI from map click
function updateWeatherUIFromCoords(weather) {
    if (!weather) return;
    locationElement.textContent = `${weather.name}, ${weather.country || ''}`;
    locationSmallElement.textContent = `${weather.name}, ${weather.country || ''}`;
    temperatureElement.forEach(el => {
        el.textContent = `${Math.round(weather.temp)}°C`;
    });
    mainConditionLargeElement.textContent = weather.description;
    weatherIconElement.forEach(el => {
        el.innerHTML = getWeatherIconSVG(weather.icon, 'h-12 w-12');
    });
    humidityElement.textContent = `${weather.humidity}%`;
    windElement.textContent = `${Math.round(weather.wind)} km/h`;
    // Show recommendations
    showWeatherRecommendations(weather.description || weather.condition, weather.temp);
}

function detectAndShowWeather() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            // Use your existing function to fetch weather by coordinates
            await getWeatherByCoords(lat, lon);
            // Pan the map to the user's location
            if (map) {
                map.setView([lat, lon], 10);
                if (marker) map.removeLayer(marker);
                marker = L.marker([lat, lon]).addTo(map);
            }
        }, (error) => {
            alert('Location access denied. Please search for a city manually.');
        });
    } else {
        alert('Geolocation is not supported by your browser.');
    }
}

function shareWeather() {
    // Gather current weather info from the UI
    const location = locationElement ? locationElement.textContent : '';
    const temp = temperatureElement && temperatureElement[0] ? temperatureElement[0].textContent : '';
    const condition = mainConditionLargeElement ? mainConditionLargeElement.textContent : '';
    const url = window.location.href;
    const summary = `Weather update for ${location}: ${temp}, ${condition}. Check it out: ${url}`;

    if (navigator.share) {
        navigator.share({
            title: `Weather in ${location}`,
            text: summary,
            url: url
        }).catch(() => {});
    } else {
        // Fallback: copy to clipboard
        if (navigator.clipboard) {
            navigator.clipboard.writeText(summary).then(() => {
                alert('Weather summary copied to clipboard! Share it on your favorite platform.');
            });
        } else {
            alert(summary);
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadApiKeys();
    // Assign DOM elements once the document is ready
    searchInput = document.querySelector('#searchInput');
    searchButton = document.querySelector('#searchButton');
    locationElement = document.querySelector('#location');
    locationSmallElement = document.querySelector('#locationSmall');
    temperatureElement = document.querySelectorAll('#temperature');
    mainConditionLargeElement = document.querySelector('#mainConditionLarge');
    timeElement = document.querySelector('#dateTime');
    humidityElement = document.querySelector('#humidity');
    windElement = document.querySelector('#windSpeed');
    forecastContainer = document.querySelector('#forecast');
    weatherIconElement = document.querySelectorAll('#weatherIcon');
    hourlyForecastContainer = document.querySelector('#hourlyForecast');

    // New: Dark Mode elements assignment
    darkModeToggle = document.querySelector('#darkModeToggle');
    sunIcon = document.querySelector('#sun-icon');
    moonIcon = document.querySelector('#moon-icon');

    // Search icon focuses the input
    if (searchButton && searchInput) {
        searchButton.addEventListener('click', () => {
            searchInput.focus();
        });
    }

    // Search input: Enter triggers search
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const city = searchInput.value.trim();
                if (city) {
                    getWeatherData(city);
                    searchInput.value = '';
                }
            }
        });
    }

    // Dark Mode toggle listener
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            const currentTheme = localStorage.getItem('theme');
            if (currentTheme === 'light') {
                applyTheme('dark');
            } else {
                applyTheme('light');
            }
        });
    }

    // Apply saved theme or default to dark mode on load
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        applyTheme('dark'); // Default to dark mode
    }

    // Initialize with default city
    getWeatherData('London');

    // Chart tab event listeners (use correct IDs)
    const chartHourlyBtn = document.getElementById('chartHourlyBtn');
    const chartDailyBtn = document.getElementById('chartDailyBtn');
    const chartOtherBtn = document.getElementById('chartOtherBtn');
    if (chartHourlyBtn) {
        chartHourlyBtn.addEventListener('click', () => {
            setChartTab('hourly');
            renderWeatherChart('hourly');
        });
    }
    if (chartDailyBtn) {
        chartDailyBtn.addEventListener('click', () => {
            setChartTab('daily');
            renderWeatherChart('daily');
        });
    }
    if (chartOtherBtn) {
        chartOtherBtn.addEventListener('click', () => {
            setChartTab('other');
            renderWeatherChart('other');
        });
    }
    // Re-enable 14/30 days forecast buttons in the forecast section (remove disabling styles and alert)
    const forecastTabs = document.querySelectorAll('.glass-card .forecast-tab');
    if (forecastTabs.length >= 3) {
        forecastTabs[1].style.opacity = '';
        forecastTabs[1].style.pointerEvents = '';
        forecastTabs[1].title = '';
        forecastTabs[1].replaceWith(forecastTabs[1].cloneNode(true)); // Remove old event listeners
        forecastTabs[2].style.opacity = '';
        forecastTabs[2].style.pointerEvents = '';
        forecastTabs[2].title = '';
        forecastTabs[2].replaceWith(forecastTabs[2].cloneNode(true)); // Remove old event listeners
    }

    // Historical weather event listener
    const fetchHistoricalBtn = document.getElementById('fetchHistoricalBtn');
    if (fetchHistoricalBtn) {
        fetchHistoricalBtn.addEventListener('click', () => {
            const city = document.getElementById('historicalLocation').value.trim();
            const date = document.getElementById('historicalDate').value;
            if (!city || !date) {
                document.getElementById('historicalResult').innerHTML = '<span class="text-red-300">Please enter a city and select a date.</span>';
                return;
            }
            fetchHistoricalWeather(city, date);
        });
    }

    // Initialize map after keys are loaded and DOM is ready
    setTimeout(() => {
        if (document.getElementById('weatherMap')) {
            initMap();
        }
    }, 100);
    // Auto-detect location on page load
    detectAndShowWeather();

    // THEME SWITCHING
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.addEventListener('change', function() {
            document.body.classList.remove('theme-winter', 'theme-summer', 'theme-contrast');
            if (this.value) document.body.classList.add(this.value);
            localStorage.setItem('theme', this.value);
        });
        // On load, restore theme
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.body.classList.add(savedTheme);
            themeSelect.value = savedTheme;
        }
    }

    // LOADING SPINNER
    function setLoadingState(isLoading) {
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) spinner.style.display = isLoading ? 'flex' : 'none';
    }

    // WEATHER ICON ANIMATIONS (GSAP)
    window.addEventListener('DOMContentLoaded', () => {
        if (window.gsap) {
            // Animate raindrops
            gsap.to('.raindrop', { y: 12, repeat: -1, yoyo: true, duration: 0.8, stagger: 0.2, ease: 'power1.inOut' });
            // Animate sun pulse
            gsap.to('#sunIconAnim circle', { scale: 1.15, transformOrigin: '50% 50%', repeat: -1, yoyo: true, duration: 1.2, ease: 'sine.inOut' });
        }
    });

    // FOCUS VISIBLE OUTLINE
    window.addEventListener('keydown', e => {
        if (e.key === 'Tab') document.body.classList.add('user-is-tabbing');
    });
    window.addEventListener('mousedown', () => {
        document.body.classList.remove('user-is-tabbing');
    });

    // Fetch weather data from backend
    fetch(`http://127.0.0.1:8000/api/weather/?city=${encodeURIComponent(city)}`)
        .then(response => response.json())
        .then(data => {
            // Use the data in your frontend
            console.log('Weather data from backend:', data);
            // Example: display on the page
            document.getElementById('weather').textContent =
                `Temperature: ${data.temperature}°C, Condition: ${data.condition}`;
        })
        .catch(error => {
            console.error('Error fetching weather data:', error);
        });
});

// Example function to fetch weather data from backend
async function fetchWeatherFromBackend(city) {
    try {
        const response = await fetch(`http://127.0.0.1:8000/api/weather/?city=${encodeURIComponent(city)}`);
        if (!response.ok) throw new Error('City not found');
        const data = await response.json();
        // Update UI with data
        document.getElementById('weather').textContent =
            `Temperature: ${data.temperature}\u00b0C, Condition: ${data.condition}`;
        // You can update other UI elements as needed
    } catch (error) {
        document.getElementById('weather').textContent = 'Error fetching weather data.';
        console.error('Error fetching weather data:', error);
    }
}

// Example usage: fetch weather for London on page load
fetchWeatherFromBackend('London');

// If you have a search input, call fetchWeatherFromBackend(city) when user searches
// ... existing code ... 