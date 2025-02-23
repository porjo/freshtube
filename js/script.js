/* eslint-disable no-unused-expressions */
/* eslint-disable no-undef */
'use strict'

// Extend dayjs plugins
dayjs.extend(window.dayjs_plugin_relativeTime)
dayjs.extend(window.dayjs_plugin_duration)

class YouTubeAPIConstants {
  static CHANNEL_URL = 'https://www.googleapis.com/youtube/v3/channels?part=contentDetails'
  static PLAYLIST_URL = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet'
  static DURATION_URL = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails'
  static LIVE_BROADCAST_URL = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails'
  static WATCH_URL = 'https://www.youtube.com/watch'
  static SPONSOR_BLOCK_URL = 'https://sponsor.ajay.app/api/skipSegments'
  static ITUNES_NAMESPACE = 'http://www.itunes.com/dtds/podcast-1.0.dtd'
}

class RegexPatterns {
  static CHANNEL = /youtube\.com\/channel\/([^/]+)\/?/
  static USER = /youtube\.com\/user\/([^/]+)\/?/
  static HANDLE = /youtube\.com\/(@[^/]+)\/?/
  static RSS = /(\/feed|rss|\.xml)/
  static NEXTCLOUD = /s\/[a-zA-Z0-9]{15}(\/download\/?)?$/
}

class ConfigManager {
  constructor () {
    this.config = {
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
  }

  async load () {
    if (typeof Storage === 'undefined') return

    const storedConfig = localStorage.getItem('freshtube_config')
    if (storedConfig) {
      this.config = { ...this.config, ...JSON.parse(storedConfig) }
    }

    this.updateUI()
    if (this.config.lines || this.config.weblinkURL) {
      await this.handleCache()
    }
    this.save()
  }

  save () {
    this.config.lines = $('#video_urls').val().split('\n').filter(i => i)
    this.config.highlightNew = $('#highlight_new').is(':checked')
    this.config.lastRefresh = dayjs().toISOString()
    this.config.hideOldCheck = $('#hide_old_check').is(':checked')
    this.config.hideOldDays = Number($('#hide_old_days').val())
    this.config.hideFutureCheck = $('#hide_future_check').is(':checked')
    this.config.hideFutureHours = Number($('#hide_future_hours').val())
    this.config.hideTimeCheck = $('#hide_time_check').is(':checked')
    this.config.hideTimeMins = Number($('#hide_time_mins').val())
    this.config.videoClickTarget = $('#vc_target').val()
    this.config.weblinkURL = $('#weblink_url').val()
    this.config.cacheResultMins = $('#cache_result_mins').val()

    localStorage.setItem('freshtube_config', JSON.stringify(this.config))
  }

  updateUI () {
    $('#apikey').val(this.config.key)
    $('#highlight_new').prop('checked', this.config.highlightNew)
    $('#hide_old_check').prop('checked', this.config.hideOldCheck)
    $('#hide_old_days').val(this.config.hideOldDays)
    $('#hide_future_check').prop('checked', this.config.hideFutureCheck)
    $('#hide_future_hours').val(this.config.hideFutureHours)
    $('#hide_time_check').prop('checked', this.config.hideTimeCheck)
    $('#hide_time_mins').val(this.config.hideTimeMins)
    $('#cache_result_mins').val(this.config.cacheResultMins)
    $('#vc_target').val(this.config.videoClickTarget)
    $('#weblink_url').val(this.config.weblinkURL)
    $('#video_urls').val(this.config.lines?.join('\n') || '')
  }

  async handleCache () {
    console.time('cache')
    if (!this.config.cacheResultMins || !this.config.lastRefresh ||
        dayjs().subtract(this.config.cacheResultMins, 'minutes').isAfter(this.config.lastRefresh)) {
      await videoManager.refresh()
      this.config.cachedResult = $('#videos').html()
    } else {
      $('#videos').html(this.config.cachedResult)
    }
    console.timeLog('cache', 'content loaded')
  }
}

class VideoManager {
  constructor (configManager) {
    this.configManager = configManager
    this.ytIds = []
    this.videos = ''
    this.rssItemLimit = 20
  }

  async refresh () {
    $('#error-box').hide()
    this.configManager.config.key = $('#apikey').val()

    if (!this.configManager.config.key) {
      uiManager.showError('API key cannot be empty')
      return
    }

    this.ytIds = []
    const lines = await this.getLines()
    await this.processLines(lines)
  }

  async getLines () {
    let lines = $('#video_urls').val().split('\n')
    this.configManager.config.weblinkURL = $('#weblink_url').val()

    if (this.configManager.config.weblinkURL) {
      const url = this.formatWeblinkURL()
      try {
        const data = await this.fetchData(url, false)
        lines = data.split(/\n/).concat(lines)
      } catch (error) {
        uiManager.showError(`failed to fetch web link - check CORS headers: ${error.message}`)
      }
    }
    return Array.from(new Set(lines))
  }

  formatWeblinkURL () {
    let url = this.configManager.config.weblinkURL
    const found = url.match(RegexPatterns.NEXTCLOUD)
    if (found && !found[1]) {
      url += '/download'
    }
    return url
  }

  async processLines (lines) {
    $('#videos').html('')
    $('.overlay').show()

    const promises = lines.map(line => this.processLine(line))
    await Promise.all(promises)
    await this.getDurations()

    uiManager.sortChannels()
    uiManager.updateHiddenItemsStatus()

    await Promise.all([this.getSponsorBlock(), this.getLiveBroadcasts()])

    $('.overlay').hide()
  }

  async processLine (line) {
    if (!line.trim() || line.match(/^#/)) return

    $('#settings').slideUp()

    if (RegexPatterns.RSS.test(line)) {
      await this.handleRSS(line)
    } else {
      await this.handleYouTubeChannel(line)
    }
  }

  async fetchData (url, json = true) {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`network response was not ok: ${response.statusText}`)
    }
    return json ? response.json() : response.text()
  }

  async handleRSS (line) {
    try {
      const data = await this.fetchData(line, false)
      const parser = new DOMParser()
      const doc = parser.parseFromString(data, 'text/xml')
      const channel = doc.querySelector('channel')

      const channelTitle = channel.querySelector('title')?.textContent || ''
      const channelURL = channel.querySelector('link')?.textContent || ''
      const channelImageURL = channel.querySelector('image')?.getAttribute('url') || ''

      let videosOuter = `<div class="channel">
                <div class="channel_title"><a href="${channelURL}" title="${line}" target="_blank">${channelTitle}</a></div>
                <div class="video_list">`
      this.videos = ''

      const rssVids = Array.from(channel.querySelectorAll('item'))
        .slice(0, this.rssItemLimit)
        .map(item => this.processRSSItem(item, channelImageURL))

      rssVids.forEach(v => this.videoHTML(v))

      videosOuter += this.videos || '<i>no videos found</i>'
      videosOuter += '</div></div>'

      $('#videos').append(videosOuter)
    } catch (error) {
      uiManager.showError(error.message)
    }
  }

  processRSSItem (item, channelImageURL) {
    const imageElements = item.getElementsByTagNameNS(YouTubeAPIConstants.ITUNES_NAMESPACE, 'image')
    const itemImageURL = imageElements.length ? imageElements[0].getAttribute('href') : channelImageURL

    const enclosureElement = item.querySelector('enclosure')
    const watchURL = enclosureElement?.getAttribute('url') ||
                        item.querySelector('link')?.textContent || ''

    const durationElements = item.getElementsByTagNameNS(YouTubeAPIConstants.ITUNES_NAMESPACE, 'duration')
    const duration = durationElements.length ? durationElements[0].textContent : ''

    return {
      snippet: {
        title: item.querySelector('title')?.textContent || '',
        resourceId: { videoId: item.querySelector('guid')?.textContent || '' },
        thumbnails: { medium: { url: itemImageURL } },
        publishedAt: item.querySelector('pubDate')?.textContent || '',
        watchURL,
        duration
      }
    }
  }

  async handleYouTubeChannel (line) {
    let url = `${YouTubeAPIConstants.CHANNEL_URL}&key=${this.configManager.config.key}`
    let channelURL = 'https://www.youtube.com/'
    const chanMatches = line.match(RegexPatterns.CHANNEL)
    const userMatches = line.match(RegexPatterns.USER)
    const handleMatches = line.match(RegexPatterns.HANDLE)

    if (chanMatches?.[1]) {
      channelURL += `channel/${chanMatches[1]}`
      url += `&id=${chanMatches[1]}`
    } else if (userMatches?.[1]) {
      channelURL += `user/${userMatches[1]}`
      url += `&forUsername=${userMatches[1]}`
    } else if (handleMatches?.[1]) {
      channelURL += handleMatches[1]
      url += `&forHandle=${handleMatches[1]}`
    } else {
      const id = line.trim()
      url += id.length === 24 ? `&id=${id}` : `&forUsername=${id}`
      channelURL += id.length === 24 ? `channel/${id}` : `user/${id}`
    }

    try {
      const data = await this.fetchData(url)
      if (data?.items) {
        const playlistID = data.items[0].contentDetails.relatedPlaylists.uploads
        const playlistUrl = `${YouTubeAPIConstants.PLAYLIST_URL}&key=${this.configManager.config.key}&playlistId=${playlistID}`
        const playlistData = await this.fetchData(playlistUrl)
        await this.handlePlaylist(channelURL, playlistData)
      }
    } catch (error) {
      uiManager.showError(error.message)
    }
  }

  async handlePlaylist (channelURL, data) {
    if (!data?.items?.length) return

    data.items.sort((a, b) => dayjs(a.snippet.publishedAt).isBefore(b.snippet.publishedAt) ? 1 : -1)

    let videosOuter = `<div class="channel">
            <div class="channel_title"><a href="${channelURL}/videos" target="_blank">${data.items[0].snippet.channelTitle}</a></div>
            <div class="video_list">`
    this.videos = ''

    data.items.forEach(v => this.videoHTML(v))

    videosOuter += this.videos || '<i>no videos found</i>'
    videosOuter += '</div></div>'

    $('#videos').append(videosOuter)
  }

  async getSponsorBlock () {
    const promises = this.ytIds.filter(id => id.length === 11).map(async videoId => {
      try {
        const response = await fetch(`${YouTubeAPIConstants.SPONSOR_BLOCK_URL}?videoID=${videoId}`)
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data) && data.length) {
            $(`.video[data-id="${videoId}"] .sponsorblock > img`).show()
          }
        }
      } catch (error) {
        uiManager.showError(`failed to fetch SponsorBlock: ${error.message}`)
      }
    })
    await Promise.all(promises)
  }

  async getDurations () {
    const url = `${YouTubeAPIConstants.DURATION_URL}&key=${this.configManager.config.key}&id=${this.ytIds.join(',')}`
    try {
      const data = await this.fetchData(url)
      data.items.forEach(v => this.processDuration(v))
    } catch (error) {
      uiManager.showError(`failed to fetch durations: ${error.message}`)
    }
  }

  processDuration (v) {
    const duration = dayjs.duration(v.contentDetails.duration)
    const durationStr = `${duration.hours() > 0 ? duration.hours() + ':' : ''}${pad(duration.minutes(), 2)}:${pad(duration.seconds(), 2)}`

    $(`.video[data-id="${v.id}"] .video_duration`).text(durationStr)

    const minutes = duration.as('minutes')
    if (this.configManager.config.hideTimeCheck && minutes > 0 && minutes < this.configManager.config.hideTimeMins) {
      $(`.video[data-id="${v.id}"]`).addClass('would_hide')
    }
  }

  async getLiveBroadcasts () {
    const url = `${YouTubeAPIConstants.LIVE_BROADCAST_URL}&key=${this.configManager.config.key}&id=${this.ytIds.join(',')}`
    try {
      const data = await this.fetchData(url)
      data.items.forEach(v => this.processLiveBroadcast(v))
    } catch (error) {
      uiManager.showError(`failed to fetch live broadcasts: ${error.message}`)
    }
  }

  processLiveBroadcast (v) {
    if (v.snippet.liveBroadcastContent === 'upcoming') {
      if (this.configManager.config.hideFutureCheck &&
          dayjs().add(this.configManager.config.hideFutureHours, 'hours').isBefore(v.liveStreamingDetails.scheduledStartTime)) {
        $(`.video[data-id="${v.id}"]`).addClass('would_hide')
      }
      $(`.video[data-id="${v.id}"] .video_sched`).text(dayjs(v.liveStreamingDetails.scheduledStartTime).fromNow()).show()
      $(`.video[data-id="${v.id}"] .video_thumb img`).addClass('grey-out')
    } else if (v.snippet.liveBroadcastContent === 'live') {
      $(`.video[data-id="${v.id}"] .video_duration`).html('<div class="live"><span class="glyphicon glyphicon-record"></span> Live</div>')
    }
  }

  videoHTML (v) {
    if (this.configManager.config.hideOldCheck &&
        dayjs().subtract(this.configManager.config.hideOldDays, 'days').isAfter(v.snippet.publishedAt)) {
      return
    }

    const id = v.snippet.resourceId.videoId
    let rssHide = false
    let rssLive = false
    let duration

    if ('duration' in v.snippet) {
      if (!v.snippet.duration) {
        rssLive = true
      } else {
        duration = v.snippet.duration.includes(':')
          ? dayjs.duration(hmsToSecondsOnly(v.snippet.duration), 'seconds')
          : dayjs.duration(v.snippet.duration, 'seconds')
        if (this.configManager.config.hideTimeCheck && duration.as('minutes') < this.configManager.config.hideTimeMins) {
          rssHide = true
        }
      }
    } else {
      this.ytIds.push(id)
    }

    const fullTitle = v.snippet.title
    const title = fullTitle.length > 50 ? fullTitle.substring(0, 50) + '...' : fullTitle
    const watch = 'watchURL' in v.snippet ? v.snippet.watchURL : `${YouTubeAPIConstants.WATCH_URL}?v=${id}`
    const clickURL = this.getClickURL(watch)

    let video = `<a class="video${rssHide ? ' would_hide' : ''}" data-id="${id}" href="${clickURL}" target="_blank">
            <div class="video_thumb"><div class="video_sched"></div><img src="${v.snippet.thumbnails.medium.url}"></div>
            <div class="video_title" title="${fullTitle}">${title}</div>`

    if (duration) {
      video += `<div class="video_duration">${duration.hours() > 0 ? duration.hours() + ':' : ''}${pad(duration.minutes(), 2)}:${pad(duration.seconds(), 2)}</div>`
    } else if (rssLive) {
      video += '<div class="video_duration"><div class="live"><span class="glyphicon glyphicon-record"></span> Live</div></div>'
    } else {
      video += '<div class="video_duration"></div>'
    }

    const publishedAt = dayjs(v.snippet.publishedAt)
    video += `<div class="video_footer">
            <div class="sponsorblock"><img src="sponsorblock.png"></div>
            <div class="age" data-unix="${publishedAt.unix()}">${publishedAt.fromNow()}</div>
        </div>`

    if (this.configManager.config.lastRefresh && this.configManager.config.highlightNew &&
        dayjs(this.configManager.config.lastRefresh).isBefore(v.snippet.publishedAt)) {
      video += '<div class="ribbon"><span>New</span></div>'
    }
    video += '</a>'

    this.videos += video
  }

  getClickURL (url) {
    return this.configManager.config.videoClickTarget
      ? this.configManager.config.videoClickTarget.replace('%v', encodeURIComponent(url))
      : url
  }
}

class UIManager {
  showError (message) {
    $('.overlay').hide()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    let errMsg = typeof message === 'string' ? message : 'Unknown error occurred'

    if (typeof message === 'object' && 'responseJSON' in message) {
      errMsg = message.responseJSON.error.errors
        .map(val => `${val.reason}, ${val.message}`)
        .join('; ')
    }

    $('#error-box').text(`Error: ${errMsg}`).show()
  }

  sortChannels () {
    const list = $('#videos')[0]
    const listItems = Array.from(list.children)

    listItems.sort((a, b) => {
      const aAges = a.querySelectorAll('.video:not(.would_hide) .age')
      const bAges = b.querySelectorAll('.video:not(.would_hide) .age')

      if (!aAges.length && !bAges.length) return 0
      if (aAges.length && !bAges.length) return -1
      if (bAges.length && !aAges.length) return 1

      if (aAges.length && bAges.length) {
        const aUnix = aAges[0].getAttribute('data-unix')
        const bUnix = bAges[0].getAttribute('data-unix')
        return aUnix > bUnix ? -1 : 1
      }

      const aListNew = a.querySelectorAll('.video:not(.would_hide) .ribbon')
      const bListNew = b.querySelectorAll('.video:not(.would_hide) .ribbon')
      if (aListNew.length > bListNew.length) return -1

      const aList = a.querySelectorAll('.video:not(.would_hide)')
      const bList = b.querySelectorAll('.video:not(.would_hide)')
      return aList.length > bList.length ? -1 : 1
    }).forEach(node => list.appendChild(node))
  }

  updateHiddenItemsStatus () {
    $('.channel').each(function () {
      const hasHidden = $(this).find('.video_list .video').is(':hidden')
      if (hasHidden) {
        $(this).find('.channel_title')
          .append('<span class="show_hidden glyphicon glyphicon-eye-open"></span>')
      }
    })
  }
}

// Initialize
const configManager = new ConfigManager()
const uiManager = new UIManager()
const videoManager = new VideoManager(configManager)

// Event listeners
$(document).ready(() => {
  configManager.load()
  if (!configManager.config.key) $('#settings').slideDown()

  $('body').on('click', '.show_hidden', function () {
    $(this).closest('.channel').find('.would_hide').slideToggle(200)
  })

  $('#settings_button').click(() => $('#settings').slideToggle(200))

  $('#save_button').click(async () => {
    await videoManager.refresh()
    configManager.save()
  })
})

// Utility functions
function pad (n, width, z = '0') {
  n = n + ''
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n
}

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
