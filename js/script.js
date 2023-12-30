var apiChannelURL = "https://www.googleapis.com/youtube/v3/channels?part=contentDetails";
var apiPlaylistURL = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet";
var apiDurationURL = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails";
var apiLiveBroadcastURL = "https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails";
var watchURL = "https://www.youtube.com/watch";

var channelRe = /youtube\.com\/channel\/([^\/]+)\/?/;
var userRe = /youtube\.com\/user\/([^\/]+)\/?/;
var rssRe = /(\/feed|rss|\.xml)/;
var nextcloudRe = /\/download\/?$/;


(function() {

	var ids = [];
	var videos = "";
	var key = "";
	var lines = [];
	var lastRefresh = null;
	var highlightNew = true;
	var hideOldCheck = true;
	var hideOldDays = 1;
	var hideFutureheck = true;
	var hideFutureHours = 2;
	var hideTimeCheck = true;
	var hideTimeMins = 20;
	var videoClickTarget = null;
	var nextcloudURL = null;

	$.ajaxSetup({
		cache: false
	});

	if (typeof(Storage) !== "undefined") {
		$("#apikey").val(localStorage.getItem("apikey"));
		highlightNew = localStorage.getItem("highlightNew") === 'false' ? false : true;
		$("#highlight_new").prop('checked', highlightNew);
		hideOldCheck = localStorage.getItem("hideOldCheck") === 'true' ? true : false;
		$("#hide_old_check").prop('checked', hideOldCheck);
		hideOldDays = Number(localStorage.getItem("hideOldDays"));
		if( hideOldDays > 0 ) {
			$("#hide_old_days").val(hideOldDays);
		}
		hideFutureCheck = localStorage.getItem("hideFutureCheck") === 'true' ? true : false;
		$("#hide_future_check").prop('checked', hideFutureCheck);
		hideFutureHours = Number(localStorage.getItem("hideFutureHours"));
		if( hideFutureHours > 0 ) {
			$("#hide_future_hours").val(hideFutureHours);
		}
		$("#hide_time_check").prop('checked', hideTimeCheck);
		hideTimeMins = Number(localStorage.getItem("hideTimeMins"));
		if( hideTimeMins > 0 ) {
			$("#hide_time_mins").val(hideTimeMins);
		}
		videoClickTarget = localStorage.getItem("videoClickTarget");
		$("#vc_target").val(videoClickTarget);
		nextcloudURL = localStorage.getItem("nextcloudURL");
		var linesStr = localStorage.getItem("lines");
		if(linesStr || nextcloudURL) {
			$("#nextcloud_url").val(nextcloudURL);
			$("#video_urls").val(linesStr);
			refresh();
		}
		// Don't put anything here - refresh() should happen last
	}

	key = $("#apikey").val();
	if (key == '') {
		$("#settings").slideDown();
	}

	$("body").on("click", ".close_channel", function() {
		$(this).closest(".channel").slideUp();
	});

	$("body").on("click", ".show_hidden", function() {
		$(this).closest(".channel").find(".would_hide").slideToggle(200);
	});

	$("#settings_button").click(function() {
		$("#settings").slideToggle(200);
	});

	$("#save_button").click(function() {
		refresh();
	});

	$("#videos").on("click", ".ribbon", function() {
		var href = $(this).closest(".video").find(".video_thumb > a").attr("href");
		location.href = href;
	});

	function errorBox(data) {
		window.scrollTo({ top: 0, behavior: 'smooth' });
		var errMsg = 'Unknown error occured';
		if(typeof data == 'object' && 'responseJSON' in data ) {
			$.each(data.responseJSON.error.errors, function(idx,val) {
				errMsg = val.reason + ', ' + val.message;
			});
		} else if (typeof data == 'string') {
			errMsg = data;
		}
		$("#error-box").text('Error: ' + errMsg).show();
		//return Promise.reject(errMsg);
	}

	function refresh() {
		$("#error-box").hide();
		key = $("#apikey").val();
		if (key == '') {
			errorBox('API key cannot be empty');
			return;
		}
		ids = [];
		var lines = '';
		nextcloudURL = $("#nextcloud_url").val();
		if( nextcloudURL != '' ) {
			// Append /download to get raw file
			if( nextcloudURL.match(nextcloudRe) === null ) {
				nextcloudURL += "/download";
			}
			$.when($.get(nextcloudURL)).then(function(data) {
				lines = data.split(/\n/);
				let lines2 = $("#video_urls").val().split(/\n/);
				lines.push(...lines2);
				let uLines = new Set(lines); // Set is unique
				_refresh(Array.from(uLines));
			},function(data) {
				errorBox('failed to fetch Nextcloud share link - check CORS headers')
			});
		} else {
			lines = $("#video_urls").val().split(/\n/);
			_refresh(lines);
		}
	}

	function _refresh(lines) {
		$("#videos").html('');

		if (typeof(Storage) !== "undefined") {
			var lr = moment(localStorage.getItem("lastRefresh"));
			if(lr) {
				lastRefresh = moment(lr);
			}
			localStorage.setItem("lines", $("#video_urls").val());
			localStorage.setItem("apikey", key);
			localStorage.setItem("lastRefresh", moment().toISOString());
			highlightNew = $("#highlight_new").is(":checked");
			localStorage.setItem("highlightNew", highlightNew);
			hideOldCheck = $("#hide_old_check").is(":checked");
			localStorage.setItem("hideOldCheck", hideOldCheck);
			hideOldDays = $("#hide_old_days").val();
			localStorage.setItem("hideOldDays", hideOldDays);
			hideFutureCheck = $("#hide_future_check").is(":checked");
			localStorage.setItem("hideFutureCheck", hideFutureCheck);
			hideFutureHours = $("#hide_future_hours").val();
			localStorage.setItem("hideFutureHours", hideFutureHours);
			hideTimeCheck = $("#hide_time_check").is(":checked");
			localStorage.setItem("hideTimeCheck", hideTimeCheck);
			hideTimeMins = $("#hide_time_mins").val();
			localStorage.setItem("hideTimeMins", hideTimeMins);
			videoClickTarget = $("#vc_target").val();
			localStorage.setItem("videoClickTarget", videoClickTarget);
			nextcloudURL = $("#nextcloud_url").val();
			localStorage.setItem("nextcloudURL", nextcloudURL);
		}

		$.when.apply($, lines.map(function(line) {
			if( line.trim() == "" ) {return; }
			$("#settings").slideUp();
			if( line.match(rssRe) !== null ) {
				return $.get(line).then(function(data) {
					handleRSS(data);
				}, errorBox);
			} else {
				var url = apiChannelURL + "&key=" + key;
				var chanMatches = line.match(channelRe);
				var userMatches = line.match(userRe);
				var channelURL = 'https://www.youtube.com/';
				if( chanMatches && chanMatches.length > 1 ) {
					channelURL += 'channel/' + chanMatches[1];
					url += "&id=" + chanMatches[1];
				} else if( userMatches && userMatches.length > 1 ) {
					channelURL += 'user/' + userMatches[1];
					url += "&forUsername=" + userMatches[1];
				} else {
					id = line.trim();
					if( id.length == 24 ) {
						url += "&id=" + id;
					} else {
						url += "&forUsername=" + id;
					}
				}
				return $.get(url).then(handleChannel, errorBox).then(function(data) {
					handlePlaylist(channelURL, data);
				}, errorBox);
			}
		})).done(function() {
			getDurations();
			getLiveBroadcasts();
			setTimeout(function() {
				hiddenItemsStatus();
			},1000);
		});
	}

	function hiddenItemsStatus() {
		$(".channel").each(function() {
			var hiddenVids = false;
			$(this).find(".video_list .video").each(function () {
				if( $(this).css('display') === 'none' ) {
					$(this).addClass('would_hide');
					hiddenVids = true;
				}
			});

			if(hiddenVids) {
				var showHidden = $("<div class='show_hidden'><span class='glyphicon glyphicon-eye-open'></span></div>");
				$(this).find(".channel_title").append(showHidden);
			}
		});
	}

	function handleChannel(data) {
		if( typeof data === 'undefined' || typeof data.items === 'undefined' ) {return;}
		var playlistID = data.items[0].contentDetails.relatedPlaylists.uploads;
		url = apiPlaylistURL + "&key=" + key + "&playlistId=" + playlistID;
		return $.get(url);
	}

	function handlePlaylist(apiChannelURL, data) {

		if( typeof data === 'undefined' || typeof data.items === 'undefined' ) {return;}
		if( data.items.length == 0 ) { return; }
		// sort items by publish date
		data.items.sort(function (a,b) {
			return moment(a.snippet.publishedAt).isBefore(
				 moment(b.snippet.publishedAt)
			);
		});
		videosOuter = "<div class='channel'>";
		var channelTitle = data.items[0].snippet.channelTitle;
		videosOuter += "<div class='channel_title'><a href='" + apiChannelURL + "/videos' target='_blank'>" + channelTitle + "</a>";
		videosOuter += "<div class='close_channel'><span class='glyphicon glyphicon-remove'></span></div>";
		videosOuter += "</div>";
		videosOuter += "<div class='video_list'>";
		videos = '';
		$.each(data.items, videoHTML);
		if( videos !== '' ) {
			videosOuter += videos;
		} else {
			videosOuter += "<i>no videos found</i>";
		}
		videosOuter += "</div>";
		videosOuter += "</div>";

		$("#videos").append( videosOuter );
	}

	function handleRSS(data) {
		if( data.length == 0 ) { return; }

		var $channel = $(data).find("channel");

		var channelTitle = $channel.find("title:first").text();
		var channelURL =  $channel.find("link:first").text();
		var channelImageURL =  $channel.find("image:first url").text();

		videosOuter = "<div class='channel'>";
		videosOuter += "<div class='channel_title'><a href='" + channelURL + "' target='_blank'>" + channelTitle + "</a>";
		videosOuter += "<div class='close_channel'><span class='glyphicon glyphicon-remove'></span></div>";
		videosOuter += "</div>";
		videosOuter += "<div class='video_list'>";
		videos = '';

		var rssVids = [];
		$channel.find("item").slice(0,10).each(function () {
			$el = $(this);
			itemImageURL = $el.find("itunes\\:image").attr('href');
			if( itemImageURL == '' ) {
				itemImageURL = channelImageURL;
			}
			rssVids.push({
				"snippet": {
					"title": $el.find("title").text(),
					"resourceId": {
						"videoId": $el.find("guid").text()
					},
					"thumbnails": {
						"medium": {"url": itemImageURL}
					},
					"publishedAt": $el.find("pubDate").text(),
					"watchURL": $el.find("enclosure").attr('url'),
					"duration": $el.find("itunes\\:duration").text()
				}
			});
		});

		//console.log(rssVids);

		$.each(rssVids, videoHTML);
		if( videos !== '' ) {
			videosOuter += videos;
		} else {
			videosOuter += "<i>no videos found</i>";
		}
		videosOuter += "</div>";
		videosOuter += "</div>";

		$("#videos").append( videosOuter );
	}

	function getDurations() {
		url = apiDurationURL + "&key=" + key + "&id=" + ids.join(",");
		$.get(url, function(data) {
			$.each(data.items, function(k,v) {
				var duration = moment.duration(v.contentDetails.duration);
				var sec = ('00'+ duration.seconds().toString()).substring(duration.seconds().toString().length);
				var min = ('00'+ duration.minutes().toString()).substring(duration.minutes().toString().length);
				var durationStr = min + ":" + sec;
				if( duration.hours() > 0 ) {
					durationStr = duration.hours() + ":" + durationStr;
				}
				// don't output duration if value already exists e.g. if live broadcast
				if( $("#" + v.id + " .video_duration").text() !== "" ) {
					return;
				}
				$("#" + v.id + " .video_duration").text(durationStr);
				if( hideTimeCheck &&  duration.as('minutes') < hideTimeMins ) {
					$("#" + v.id).hide();
					return;
				}
			});
		});
	}

	function getLiveBroadcasts() {
		url = apiLiveBroadcastURL + "&key=" + key + "&id=" + ids.join(",");
		$.get(url, function(data) {
			$.each(data.items, function(k,v) {
				if( v.snippet.liveBroadcastContent === "upcoming" ) {
					if( hideFutureCheck &&  moment().add(hideFutureHours, "hours").isBefore(moment(v.liveStreamingDetails.scheduledStartTime)) ) {
						$("#" + v.id).hide();
					}
					$("#" + v.id + " .video_sched").text(moment(v.liveStreamingDetails.scheduledStartTime).fromNow()).show();
					$("#" + v.id + " .video_thumb img").addClass('grey-out');
				} else if( v.snippet.liveBroadcastContent === "live" ) {
					$("#" + v.id + " .video_duration").html("<div class='live'><span class='glyphicon glyphicon-record'></span>&nbsp;Live</div>");
				}
			});
		});
	}

	function videoHTML(k,v) {
		if( hideOldCheck &&  moment().subtract(hideOldDays, "days").isAfter(v.snippet.publishedAt) ) {
			return;
		}

		let duration;
		// RSS durations here
		if( 'duration' in v.snippet && v.snippet.duration !== "" ) {
			if(v.snippet.duration.indexOf(':') > -1) {
				if(v.snippet.duration.match(/^[0-9]{1,2}:[0-9]{1,2}$/)) {
					duration = moment.duration("00:" + v.snippet.duration);
				} else if(v.snippet.duration.match(/^[0-9]:[0-9]{1,2}:[0-9]{1,2}$/)) {
					duration = moment.duration("0" + v.snippet.duration);
				} else {
					duration = moment.duration(v.snippet.duration);
				}
			} else {
				duration = moment.duration(v.snippet.duration, 'seconds');
			}
			if( hideTimeCheck &&  duration.as('minutes') < hideTimeMins ) {
				return;
			}
		}
		var fullTitle = v.snippet.title;
		var title = v.snippet.title;
		if( title.length > 50 ) {
			title = title.substring(0,50) + "...";
		}

		var id = v.snippet.resourceId.videoId;
		ids.push(id);

		var div = "<div class='video' id='" + id + "'>"
		var watch = '';
		if( 'watchURL' in v.snippet ) {
			watch = v.snippet.watchURL;
		} else {
			watch = watchURL + "?v=" + id;
		}
		var clickURL = getClickURL(watch)
		div += "<div class='video_thumb'>";
		div += "<div class='video_sched'></div>";
		div += "<a href='" + clickURL + "' target='_blank'><img src='" + v.snippet.thumbnails.medium.url + "'></a>";
		div += "</div>";
		div += "<div class='video_title' title='" + fullTitle + "'>" + title + "</div>";
		if( duration ) {
			div += "<div class='video_duration'>" + (duration.hours() > 0 ? duration.hours() + ":" : "") + pad(duration.minutes(),2) + ":" + pad(duration.seconds(),2) + "</div>";
		} else {
			div += "<div class='video_duration'></div>";
		}
		div += "<div class='video_footer'>" + moment(v.snippet.publishedAt).fromNow() + "</div>";
		if( lastRefresh && highlightNew && moment(lastRefresh).isBefore(v.snippet.publishedAt) ) {
			div += "<div class='ribbon'><span>New</span></div>";
		}
		div += "</div>";

		videos += div;
	}

	function getClickURL(url) {

		if (!videoClickTarget) {
			return url;
		}

		return videoClickTarget.replace("%v", encodeURIComponent(url));
	}

	function pad(n, width, z) {
		z = z || '0';
		n = n + '';
		return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
	}

}());
