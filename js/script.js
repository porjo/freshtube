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
const nextcloudRe = /\/download\/?$/

let videos = ''

const rssItemLimit = 20

let lastRefresh = null

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
  nextcloudURL: null
}

$.ajaxSetup({
  cache: false
})

function loadConfig () {
  if (typeof (Storage) !== 'undefined') {
    const sconfigStr = localStorage.getItem('freshtube_config')
    if (sconfigStr) {
      config = JSON.parse(sconfigStr)
    } else {
      return
    }

    lastRefresh = config.lastRefresh
    // console.log(sconfigStr, config)
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
    $('#vc_target').val(config.videoClickTarget)
    if (config.lines || config.nextcloudURL) {
      $('#nextcloud_url').val(config.nextcloudURL)
      $('#video_urls').val(config.lines.join('\n'))
      refresh()
    }
    // Don't put anything here - refresh() should happen last
  }
}

loadConfig()

if (config.key === '') {
  $('#settings').slideDown()
}

$('body').on('click', '.close_channel', function () {
  $(this).closest('.channel').slideUp()
})

$('body').on('click', '.show_hidden', function () {
  $(this).closest('.channel').find('.would_hide').slideToggle(200)
})

$('#settings_button').click(function () {
  $('#settings').slideToggle(200)
})

$('#save_button').click(function () {
  refresh()
})

function errorBox (data) {
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
  // return Promise.reject(errMsg)
}

function refresh () {
  $('#error-box').hide()
  config.key = $('#apikey').val()
  if (config.key === '') {
    errorBox('API key cannot be empty')
    return
  }
  ytIds = []
  let lines = ''
  config.nextcloudURL = $('#nextcloud_url').val()
  if (config.nextcloudURL !== '') {
    // Append /download to get raw file
    if (config.nextcloudURL.match(nextcloudRe) === null) {
      config.nextcloudURL += '/download'
    }
    $.when($.get(config.nextcloudURL)).then(function (data) {
      lines = data.split(/\n/)
      const lines2 = $('#video_urls').val().split(/\n/)
      lines.push(...lines2)
      const uLines = new Set(lines) // Set is unique
      _refresh(Array.from(uLines))
    }, function () {
      errorBox('failed to fetch Nextcloud share link - check CORS headers')
    })
  } else {
    lines = $('#video_urls').val().split(/\n/)
    _refresh(lines)
  }
}

function _refresh (lines) {
  $('#videos').html('')

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
  config.nextcloudURL = $('#nextcloud_url').val()

  // store config in local storage
  localStorage.setItem('freshtube_config', JSON.stringify(config))

  $.when.apply($, lines.map(function (line) {
    // skip empty lines and comments
    if (line.trim() === '' || line.match(/^#/)) { return null }
    $('#settings').slideUp()
    if (line.match(rssRe) !== null) {
      return $.get(line).then(function (data) {
        handleRSS(line, data)
      }, errorBox)
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
      return $.get(url).then(handleChannel, errorBox).then(function (data) {
        handlePlaylist(channelURL, data)
      }, errorBox)
    }
  })).done(function () {
    (async () => {
      await getDurations()
      sortChannels()

      getSponsorBlock()
      getLiveBroadcasts()
      setTimeout(function () {
        hiddenItemsStatus()
      }, 1000)
    })()
  })
}

// put channels with visible videos first
function sortChannels () {
  const list = document.querySelector('#videos')
  const listItems = Array.from(list.children)
  listItems.sort((a, b) => {
    // get count of videos that are not hidden
    let aCount = a.querySelectorAll('.video:not(.would_hide)').length
    let bCount = b.querySelectorAll('.video:not(.would_hide)').length
    return aCount < bCount ? 1 : -1
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
      const showHidden = $('<div class="show_hidden"><span class="glyphicon glyphicon-eye-open"></span></div>')
      $(this).find('.channel_title').append(showHidden)
    }
  })
}

function handleChannel (data) {
  if (typeof data === 'undefined' || typeof data.items === 'undefined') { return }
  const playlistID = data.items[0].contentDetails.relatedPlaylists.uploads
  const url = apiPlaylistURL + '&key=' + config.key + '&playlistId=' + playlistID
  return $.get(url)
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
  videosOuter += '<div class="close_channel"><span class="glyphicon glyphicon-remove"></span></div>'
  videosOuter += '</div>'
  videosOuter += '<div class="video_list">'
  videos = ''
  $.each(data.items, videoHTML)
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

  const $channel = $(data).find('channel')

  const channelTitle = $channel.find('title:first').text()
  const channelURL = $channel.find('link:first').text()
  const channelImageURL = $channel.find('image:first url').text()

  let videosOuter = ''
  videosOuter = '<div class="channel">'
  videosOuter += '<div class="channel_title"><a href="' + channelURL + '" title="' + rssURL + '" target="_blank">' + channelTitle + '</a>'
  videosOuter += '<div class="close_channel"><span class="glyphicon glyphicon-remove"></span></div>'
  videosOuter += '</div>'
  videosOuter += '<div class="video_list">'
  videos = ''

  const rssVids = []
  $channel.find('item').slice(0, rssItemLimit).each(function () {
    const $el = $(this)
    let itemImageURL = $el.find('itunes\\:image').attr('href')
    if (itemImageURL === '') {
      itemImageURL = channelImageURL
    }

    let watchURL = $el.find('enclosure').attr('url')
    if (!watchURL) {
      watchURL = $el.find('link').text()
    }

    rssVids.push({
      snippet: {
        title: $el.find('title').text(),
        resourceId: {
          videoId: $el.find('guid').text()
        },
        thumbnails: {
          medium: { url: itemImageURL }
        },
        publishedAt: $el.find('pubDate').text(),
        watchURL,
        duration: $el.find('itunes\\:duration').text()
      }
    })
  })

  $.each(rssVids, videoHTML)
  if (videos !== '') {
    videosOuter += videos
  } else {
    videosOuter += '<i>no videos found</i>'
  }
  videosOuter += '</div>'
  videosOuter += '</div>'

  $('#videos').append(videosOuter)
}

function getSponsorBlock () {
  $.each(ytIds, function (k, videoId) {
    if (videoId.length !== 11) {
      return
    }
    const url = sponsorBlockURL + '?videoID=' + videoId
    $.get(url, function (data, status, xhr) {
      if (xhr.status !== 200) {
        return
      }
      if (Array.isArray(data) && data.length > 0) {
        $('#' + videoId + ' .sponsorblock > img').show()
      }
    })
  })
}

async function getDurations () {
  const url = apiDurationURL + '&key=' + config.key + '&id=' + ytIds.join(',')
  return new Promise((resolve, reject) => {
    $.get(url, function (data) {
      $.each(data.items, function (k, v) {
        const duration = dayjs.duration(v.contentDetails.duration)
        const sec = ('00' + duration.seconds().toString()).substring(duration.seconds().toString().length)
        const min = ('00' + duration.minutes().toString()).substring(duration.minutes().toString().length)
        let durationStr = min + ':' + sec
        if (duration.hours() > 0) {
          durationStr = duration.hours() + ':' + durationStr
        }
        // don't output duration if value already exists e.g. if live broadcast
        if ($('#' + v.id + ' .video_duration').text() !== '') {
          return
        }
        $('#' + v.id + ' .video_duration').text(durationStr)
        if (config.hideTimeCheck && duration.as('minutes') < config.hideTimeMins) {
          $('#' + v.id).addClass('would_hide')
        }
        resolve()
      })
    }).fail(function () {
      reject()
    })
  })
}

function getLiveBroadcasts () {
  const url = apiLiveBroadcastURL + '&key=' + config.key + '&id=' + ytIds.join(',')
  $.get(url, function (data) {
    $.each(data.items, function (k, v) {
      if (v.snippet.liveBroadcastContent === 'upcoming') {
        if (config.hideFutureCheck && dayjs().add(config.hideFutureHours, 'hours').isBefore(dayjs(v.liveStreamingDetails.scheduledStartTime))) {
          $('#' + v.id).addClass('would_hide')
        }
        $('#' + v.id + ' .video_sched').text(dayjs(v.liveStreamingDetails.scheduledStartTime).fromNow()).show()
        $('#' + v.id + ' .video_thumb img').addClass('grey-out')
      } else if (v.snippet.liveBroadcastContent === 'live') {
        $('#' + v.id + ' .video_duration').html('<div class="live"><span class="glyphicon glyphicon-record"></span>&nbsp;Live</div>')
      }
    })
  })
}

function videoHTML (k, v) {
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
  let video = '<a class="video' + (rssHide ? ' would_hide' : '') + '" id="' + id + '" href="' + clickURL + '" target="_blank">'
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
  video += '<div class="age">' + dayjs(v.snippet.publishedAt).fromNow() + '</div>'
  video += '</div>'
  if (lastRefresh && config.highlightNew && dayjs(lastRefresh).isBefore(v.snippet.publishedAt)) {
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
