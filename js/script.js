'use strict'

dayjs.extend(window.dayjs_plugin_relativeTime)
dayjs.extend(window.dayjs_plugin_duration)

const apiChannelURL = 'https://www.googleapis.com/youtube/v3/channels?part=contentDetails'
const apiPlaylistURL = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet'
const apiDurationURL = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails'
const apiLiveBroadcastURL = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails'
const watchURL = 'https://www.youtube.com/watch'
const sponsorBlockURL = 'https://sponsor.ajay.app/api/skipSegments'

const channelRe = /youtube\.com\/channel\/([^/]+)\/?/
const userRe = /youtube\.com\/user\/([^/]+)\/?/
const handleRe = /youtube\.com\/(@[^/]+)\/?/
const rssRe = /(\/feed|rss|\.xml)/
const nextcloudRe = /s\/[a-zA-Z0-9]{15}(\/download\/?)?$/

const ITUNES_NAMESPACE = 'http://www.itunes.com/dtds/podcast-1.0.dtd'

let videos = ''

const rssItemLimit = 20

let ytIds = []

let config = {
  key: '',
  lastRefresh: null,
  highlightNew: true,
  hideOldCheck: true,
  hideOldDays: 1,
  hideFutureCheck: true,
  hideFutureHours: 2,
  hideTimeCheck: false,
  hideTimeMins: 20,
  videoClickTarget: null,
  weblinkURL: null,
  cacheResultMins: 15,
  cachedResult: null
}

async function loadConfig () {
  if (typeof (Storage) !== 'undefined') {
    const sconfigStr = localStorage.getItem('freshtube_config')
    if (sconfigStr) {
      // merge default config with stored config (stored takes precedence)
      config = { ...config, ...JSON.parse(sconfigStr) }
    } else {
      return
    }

    $('#apikey').val(config.key)
    $('#highlight_new').prop('checked', config.highlightNew)
    $('#hide_old_check').prop('checked', config.hideOldCheck)
    if (config.hideOldDays > 0) {
      $('#hide_old_days').val(config.hideOldDays)
    }
    $('#hide_future_check').prop('checked', config.hideFutureCheck)
    if (config.hideFutureHours > 0) {
      $('#hide_future_hours').val(config.hideFutureHours)
    }
    $('#hide_time_check').prop('checked', config.hideTimeCheck)
    if (config.hideTimeMins > 0) {
      $('#hide_time_mins').val(config.hideTimeMins)
    }
    if (config.cacheResultMins > 0) {
      $('#cache_result_mins').val(config.cacheResultMins)
    }
    $('#vc_target').val(config.videoClickTarget)
    if (config.lines || config.weblinkURL) {
      let weblinkURL = config.weblinkURL
      if (typeof weblinkURL === 'undefined' && config.nextcloudURL) {
        weblinkURL = config.nextcloudURL
        delete config.nextcloudURL
      }
      $('#weblink_url').val(weblinkURL)
      $('#video_urls').val(config.lines.join('\n'))

      console.time('cache')
      // Only refresh if cache expired
      if (!config.cacheResultMins || !config.lastRefresh || dayjs().subtract(config.cacheResultMins, 'minutes').isAfter(config.lastRefresh)) {
        try {
          await refresh()
        } catch (error) {
          errorBox('failed to refresh: ' + error.message)
        }
        const html = $('#videos').html()
        config.cachedResult = html
      } else {
        $('#videos').html(config.cachedResult)
      }
      console.timeLog('cache', 'content loaded')
    }
    saveConfig()
  }
}

loadConfig()

if (config.key === '') {
  $('#settings').slideDown()
}

$('body').on('click', '.show_hidden', function () {
  $(this).closest('.channel').find('.would_hide').slideToggle(200)
})

$('#settings_button').click(function () {
  $('#settings').slideToggle(200)
})

$('#save_button').click(async function () {
  await refresh()
  saveConfig()
})

function errorBox (data) {
  $('.overlay').hide()
  window.scrollTo({ top: 0, behavior: 'smooth' })
  let errMsg = 'Unknown error occured'
  if (typeof data === 'object' && 'responseJSON' in data) {
    $.each(data.responseJSON.error.errors, function (idx, val) {
      errMsg = val.reason + ', ' + val.message
    })
  } else if (typeof data === 'string') {
    errMsg = data
  }
  $('#error-box').text('Error: ' + errMsg).show()
}

async function refresh () {
  $('#error-box').hide()
  config.key = $('#apikey').val()
  if (config.key === '') {
    errorBox('API key cannot be empty')
    return
  }
  ytIds = []
  let lines = ''
  config.weblinkURL = $('#weblink_url').val()
  if (config.weblinkURL !== '') {
    const found = config.weblinkURL.match(nextcloudRe)
    if (found !== null && typeof found[1] === 'undefined') {
      // Append /download to get raw file for share link
      config.weblinkURL += '/download'
    }
    try {
      const data = await fetchData(config.weblinkURL, false)
      lines = data.split(/\n/)
      const lines2 = $('#video_urls').val().split(/\n/)
      lines.push(...lines2)
      const uLines = new Set(lines) // Set is unique
      await _refresh(Array.from(uLines))
    } catch (error) {
      errorBox('failed to fetch web link - check CORS headers: ' + error.message)
    }
  } else {
    lines = $('#video_urls').val().split(/\n/)
    await _refresh(lines)
  }
}

async function fetchData (url, json = true) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`network response was not ok: ${response.statusText}`)
  }
  return json ? response.json() : response.text()
}

async function processLine (line) {
  // skip empty lines and comments
  if (line.trim() === '' || line.match(/^#/)) return

  $('#settings').slideUp()

  if (line.match(rssRe) !== null) {
    try {
      const data = await fetchData(line, false)
      handleRSS(line, data)
    } catch (error) {
      errorBox(error.message)
    }
  } else {
    let url = apiChannelURL + '&key=' + config.key
    const chanMatches = line.match(channelRe)
    const userMatches = line.match(userRe)
    const handleMatches = line.match(handleRe)
    let channelURL = 'https://www.youtube.com/'

    if (chanMatches && chanMatches.length > 1) {
      channelURL += 'channel/' + chanMatches[1]
      url += '&id=' + chanMatches[1]
    } else if (userMatches && userMatches.length > 1) {
      channelURL += 'user/' + userMatches[1]
      url += '&forUsername=' + userMatches[1]
    } else if (handleMatches && handleMatches.length > 1) {
      channelURL += handleMatches[1]
      url += '&forHandle=' + handleMatches[1]
    } else {
      const id = line.trim()
      if (id.length === 24) {
        url += '&id=' + id
        channelURL += 'channel/' + id
      } else {
        url += '&forUsername=' + id
        channelURL += 'user/' + id
      }
    }

    try {
      const data = await fetchData(url)
      if (typeof data !== 'undefined' && typeof data.items !== 'undefined') {
        const playlistID = data.items[0].contentDetails.relatedPlaylists.uploads
        const url2 = apiPlaylistURL + '&key=' + config.key + '&playlistId=' + playlistID
        const data2 = await fetchData(url2)
        await handlePlaylist(channelURL, data2)
      }
    } catch (error) {
      errorBox(error.message)
    }
  }
}

function saveConfig () {
  // update config
  config.lines = $('#video_urls').val().split('\n').filter(i => i) // filter ensures we don't get [""]
  config.highlightNew = $('#highlight_new').is(':checked')
  config.lastRefresh = dayjs().toISOString()
  config.hideOldCheck = $('#hide_old_check').is(':checked')
  config.hideOldDays = Number($('#hide_old_days').val())
  config.hideFutureCheck = $('#hide_future_check').is(':checked')
  config.hideFutureHours = Number($('#hide_future_hours').val())
  config.hideTimeCheck = $('#hide_time_check').is(':checked')
  config.hideTimeMins = Number($('#hide_time_mins').val())
  config.videoClickTarget = $('#vc_target').val()
  config.weblinkURL = $('#weblink_url').val()
  config.cacheResultMins = $('#cache_result_mins').val()

  // store config in local storage
  localStorage.setItem('freshtube_config', JSON.stringify(config))
}

async function _refresh (lines) {
  $('#videos').html('')
  $('.overlay').show()

  const promises = lines.map(line => processLine(line))

  await Promise.all(promises)
  await getDurations()

  sortChannels()
  hiddenItemsStatus()

  await Promise.all([getSponsorBlock(), getLiveBroadcasts()])

  $('.overlay').hide()
}

// channel with most recently published visible video first
// followed by channels with any visible videos
// followed by channels with only non-visible videos or no videos
function sortChannels () {
  const list = document.querySelector('#videos')
  const listItems = Array.from(list.children)
  listItems.sort((a, b) => {
    const aAges = a.querySelectorAll('.video:not(.would_hide) .age')
    const bAges = b.querySelectorAll('.video:not(.would_hide) .age')
    if (aAges.length === 0 && bAges.length === 0) {
      return 0
    }

    if (aAges.length > 0 && bAges.length === 0) {
      return -1
    }
    if (bAges.length > 0 && aAges.length === 0) {
      return 1
    }
    if (aAges.length > 0 && bAges.length > 0) {
      const aUnix = aAges[0].getAttribute('data-unix')
      const bUnix = bAges[0].getAttribute('data-unix')
      if (aUnix > bUnix) {
        return -1
      } else {
        return 1
      }
    }

    const aListNew = a.querySelectorAll('.video:not(.would_hide) .ribbon')
    const bListNew = b.querySelectorAll('.video:not(.would_hide) .ribbon')
    if (aListNew.length > bListNew.length) {
      return -1
    }
    const aList = a.querySelectorAll('.video:not(.would_hide)')
    const bList = b.querySelectorAll('.video:not(.would_hide)')
    if (aList.length > bList.length) {
      return -1
    }
    return 1
  }).forEach(node => list.appendChild(node))
}

function hiddenItemsStatus () {
  $('.channel').each(function () {
    let hiddenVids = false
    $(this).find('.video_list .video').each(function () {
      if ($(this).css('display') === 'none') {
        hiddenVids = true
      }
    })

    if (hiddenVids) {
      const showHidden = $('<span class="show_hidden glyphicon glyphicon-eye-open"></span>')
      $(this).find('.channel_title').append(showHidden)
    }
  })
}

function handlePlaylist (apiChannelURL, data) {
  if (typeof data === 'undefined' || typeof data.items === 'undefined') { return }
  if (data.items.length === 0) { return }
  // sort items by publish date
  data.items.sort(function (a, b) {
    return dayjs(a.snippet.publishedAt).isBefore(dayjs(b.snippet.publishedAt))
  })
  let videosOuter = '<div class="channel">'
  const channelTitle = data.items[0].snippet.channelTitle
  videosOuter += '<div class="channel_title"><a href="' + apiChannelURL + '/videos" target="_blank">' + channelTitle + '</a>'
  videosOuter += '</div>'
  videosOuter += '<div class="video_list">'
  videos = ''
  data.items.forEach(videoHTML)
  if (videos !== '') {
    videosOuter += videos
  } else {
    videosOuter += '<i>no videos found</i>'
  }
  videosOuter += '</div>'
  videosOuter += '</div>'

  $('#videos').append(videosOuter)
}

function handleRSS (rssURL, data) {
  if (data.length === 0) { return }

  const parser = new DOMParser()
  const doc = parser.parseFromString(data, 'text/xml')
  const channel = doc.querySelector('channel')

  const channelTitle = channel.querySelector('title') ? channel.querySelector('title').textContent : ''
  const channelURL = channel.querySelector('link') ? channel.querySelector('link').textContent : ''
  const channelImageURL = channel.querySelector('image') ? channel.querySelector('image').getAttribute('url') : ''

  let videosOuter = ''
  videosOuter += '<div class="channel">'
  videosOuter += '<div class="channel_title"><a href="' + channelURL + '" title="' + rssURL + '" target="_blank">' + channelTitle + '</a>'
  videosOuter += '</div>'
  videosOuter += '<div class="video_list">'
  videos = ''

  const rssVids = []

  Array.from(channel.querySelectorAll('item')).slice(0, rssItemLimit).forEach(item => {
    const imageElements = item.getElementsByTagNameNS(ITUNES_NAMESPACE, 'image')
    let itemImageURL = imageElements ? imageElements[0].getAttribute('href') : ''
    if (itemImageURL === '') {
      itemImageURL = channelImageURL
    }

    const enclosureElement = item.querySelector('enclosure')
    let watchURL = enclosureElement ? enclosureElement.getAttribute('url') : ''
    if (!watchURL) {
      watchURL = item.querySelector('link') ? item.querySelector('link').textContent : ''
    }

    const durationElements = item.getElementsByTagNameNS(ITUNES_NAMESPACE, 'duration')
    const duration = durationElements.length > 0 ? durationElements[0].textContent : ''

    rssVids.push({
      snippet: {
        title: item.querySelector('title') ? item.querySelector('title').textContent : '',
        resourceId: {
          videoId: item.querySelector('guid') ? item.querySelector('guid').textContent : ''
        },
        thumbnails: {
          medium: { url: itemImageURL }
        },
        publishedAt: item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : '',
        watchURL,
        duration
      }
    })
  })

  rssVids.forEach(videoHTML)

  if (videos !== '') {
    videosOuter += videos
  } else {
    videosOuter += '<i>no videos found</i>'
  }
  videosOuter += '</div>'
  videosOuter += '</div>'

  $('#videos').append(videosOuter)
}

async function getSponsorBlock () {
  const promises = ytIds.map(async (videoId) => {
    if (videoId.length !== 11) {
      return
    }
    const url = sponsorBlockURL + '?videoID=' + videoId
    try {
      const response = await fetch(url)
      // ignore 404 not found
      if (!response.ok) { return }
      const data = await response.json()
      if (Array.isArray(data) && data.length > 0) {
        $('.video[data-id="' + videoId + '"] .sponsorblock > img').show()
      }
    } catch (error) {
      errorBox('failed to fetch SponsorBlock: ' + error.message)
    }
  })
  await Promise.all(promises)
}

async function getDurations () {
  const url = apiDurationURL + '&key=' + config.key + '&id=' + ytIds.join(',')

  try {
    const data = await fetchData(url)

    data.items.forEach(v => {
      const duration = dayjs.duration(v.contentDetails.duration)
      const sec = ('00' + duration.seconds().toString()).slice(-2)
      const min = ('00' + duration.minutes().toString()).slice(-2)
      let durationStr = min + ':' + sec
      if (duration.hours() > 0) {
        durationStr = duration.hours() + ':' + durationStr
      }

      const durationElement = document.querySelector('.video[data-id="' + v.id + '"] .video_duration')
      if (durationElement) {
        durationElement.textContent = durationStr
      }

      const minutes = duration.as('minutes')
      if (config.hideTimeCheck && minutes > 0 && minutes < config.hideTimeMins) {
        const videoElement = document.querySelector('.video[data-id="' + v.id + '"]')
        if (videoElement) {
          videoElement.classList.add('would_hide')
        }
      }
    })
  } catch (error) {
    errorBox('failed to fetch durations: ' + error.message)
  }
}

async function getLiveBroadcasts () {
  const url = apiLiveBroadcastURL + '&key=' + config.key + '&id=' + ytIds.join(',')
  try {
    const data = await fetchData(url)

    data.items.forEach(v => {
      if (v.snippet.liveBroadcastContent === 'upcoming') {
        if (config.hideFutureCheck && dayjs().add(config.hideFutureHours, 'hours').isBefore(dayjs(v.liveStreamingDetails.scheduledStartTime))) {
          $('.video[data-id="' + v.id + '"]').addClass('would_hide')
        }
        $('.video[data-id="' + v.id + '"] .video_sched').text(dayjs(v.liveStreamingDetails.scheduledStartTime).fromNow()).show()
        $('.video[data-id="' + v.id + '"] .video_thumb img').addClass('grey-out')
      } else if (v.snippet.liveBroadcastContent === 'live') {
        $('.video[data-id="' + v.id + '"] .video_duration').html('<div class="live"><span class="glyphicon glyphicon-record"></span>&nbsp;Live</div>')
      }
    })
  } catch (error) {
    errorBox('failed to fetch live broadcasts: ' + error.message)
  }
}

function videoHTML (v) {
  if (config.hideOldCheck && dayjs().subtract(config.hideOldDays, 'days').isAfter(v.snippet.publishedAt)) {
    return
  }

  const id = v.snippet.resourceId.videoId

  let rssHide = false
  let rssLive = false
  let duration
  // RSS durations here
  if ('duration' in v.snippet) {
    if (v.snippet.duration === '') {
      // if duration not set we assume LIVE
      rssLive = true
    } else {
      if (v.snippet.duration.indexOf(':') > -1) {
        duration = dayjs.duration(hmsToSecondsOnly(v.snippet.duration), 'seconds')
      } else {
        duration = dayjs.duration(v.snippet.duration, 'seconds')
      }
      if (config.hideTimeCheck && duration.as('minutes') < config.hideTimeMins) {
        rssHide = true
      }
    }
  } else {
    ytIds.push(id)
  }

  const fullTitle = v.snippet.title
  let title = v.snippet.title
  if (title.length > 50) {
    title = title.substring(0, 50) + '...'
  }

  let watch = ''
  if ('watchURL' in v.snippet) {
    watch = v.snippet.watchURL
  } else {
    watch = watchURL + '?v=' + id
  }
  const clickURL = getClickURL(watch)
  // Youtube ID is set in a data attribute. Using CSS ID is problematic due to some IDs starting with a number
  let video = '<a class="video' + (rssHide ? ' would_hide' : '') + '" data-id="' + id + '" href="' + clickURL + '" target="_blank">'
  video += '<div class="video_thumb">'
  video += '<div class="video_sched"></div>'
  video += '<img src="' + v.snippet.thumbnails.medium.url + '">'
  video += '</div>'
  video += '<div class="video_title" title="' + fullTitle + '">' + title + '</div>'
  if (duration) {
    video += '<div class="video_duration">' + (duration.hours() > 0 ? duration.hours() + ':' : '') + pad(duration.minutes(), 2) + ':' + pad(duration.seconds(), 2) + '</div>'
  } else if (rssLive) {
    video += '<div class="video_duration"><div class="live"><span class="glyphicon glyphicon-record"></span>&nbsp;Live</div></div>'
  } else {
    // Youtube durations get updated in getDurations()
    video += '<div class="video_duration"></div>'
  }
  video += '<div class="video_footer">'
  video += '<div class="sponsorblock"><img src="sponsorblock.png"></div>'
  const publishedAt = dayjs(v.snippet.publishedAt)
  video += '<div class="age" data-unix="' + publishedAt.unix() + '">' + publishedAt.fromNow() + '</div>'
  video += '</div>'
  if (config.lastRefresh && config.highlightNew && dayjs(config.lastRefresh).isBefore(v.snippet.publishedAt)) {
    video += '<div class="ribbon"><span>New</span></div>'
  }
  video += '</a>'

  videos += video
}

function getClickURL (url) {
  if (!config.videoClickTarget) {
    return url
  }

  return config.videoClickTarget.replace('%v', encodeURIComponent(url))
}

function pad (n, width, z) {
  z = z || '0'
  n = n + ''
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n
}

// Credit: https://stackoverflow.com/a/9640417/202311
function hmsToSecondsOnly (str) {
  const p = str.split(':')
  let s = 0
  let m = 1

  while (p.length > 0) {
    s += m * parseInt(p.pop(), 10)
    m *= 60
  }

  return s
}
