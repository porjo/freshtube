var apiChannelURL = "https://www.googleapis.com/youtube/v3/channels?part=contentDetails";
var apiPlaylistURL = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet";
var apiDurationURL = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails";
var apiLiveBroadcastURL = "https://www.googleapis.com/youtube/v3/videos?part=snippet";
var watchURL = "https://www.youtube.com/watch";

var channelRe = /youtube\.com\/channel\/([^\/]+)\/?/;
var userRe = /youtube\.com\/user\/([^\/]+)\/?/;
var rssRe = /(\.rss|rss\.|\.xml)/;


(function() {

	var ids = [];
	var videos = "";
	var key = "";
	var lines = [];
	var lastRefresh = null;
	var highlightNew = true;
	var hideOldCheck = true;
	var hideOldDays = 1;

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
		var l = JSON.parse(localStorage.getItem("lines"));
		if(l) {
			$("#video_urls").val(l.join('\n'));
			refresh();
		}
	}

	$("body").on("click", ".close_channel", function() {
		$(this).closest(".channel").slideUp();
	});

	$("#showhide").click(function() {
		$("#search_input").slideToggle();
	});

	$("#refresh_button").click(function() {
		refresh();
	});

	$("#videos").on("click", ".ribbon", function() {
		var href = $(this).closest(".video").find(".video_thumb > a").attr("href");
		location.href = href;
	});

	function errorBox(data) {
		var errMsg = '';
		if(typeof data == 'object' && 'responseJSON' in data ) {
			$.each(data.responseJSON.error.errors, function(idx,val) {
				errMsg += 'Error: ' + val.reason + ', ' + val.message;
			});

			$("#error-box").text(errMsg).show();
		}
		return Promise.reject(errMsg);
	}

	function refresh() {
		$("#error-box").hide();
		key = $("#apikey").val();
		ids = [];
		var lines = $("#video_urls").val().split(/\n/);
		$("#videos").html('');

		if (typeof(Storage) !== "undefined") {
			var lr = moment(localStorage.getItem("lastRefresh"));
			if(lr) {
				lastRefresh = moment(lr);
			}
			localStorage.setItem("lines", JSON.stringify(lines));
			localStorage.setItem("apikey", key);
			localStorage.setItem("lastRefresh", moment().toISOString());
			highlightNew = $("#highlight_new").is(":checked");
			localStorage.setItem("highlightNew", highlightNew);
			hideOldCheck = $("#hide_old_check").is(":checked");
			localStorage.setItem("hideOldCheck", hideOldCheck);
			hideOldDays = $("#hide_old_days").val();
			localStorage.setItem("hideOldDays", hideOldDays);
		}

		$.when.apply($, lines.map(function(line) {
			if( line.trim() == "" ) {return; }
			$("#search_input").slideUp();
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
		});
	}

	function handleChannel(data) {
		if( data.items.length == 0 ) { return; }
		var playlistID = data.items[0].contentDetails.relatedPlaylists.uploads;
		url = apiPlaylistURL + "&key=" + key + "&playlistId=" + playlistID;
		return $.get(url);
	}

	function handlePlaylist(apiChannelURL, data) {
		if( data.items.length == 0 ) { return; }
		// sort items by publish date
		data.items.sort(function (a,b) {
			return moment(a.snippet.publishedAt).isBefore(
				 moment(b.snippet.publishedAt)
			);
		});
		videosOuter = "<div class='channel'>";
		var channelTitle = data.items[0].snippet.channelTitle;
		videosOuter += "<div class='channel_title'><a href='" + apiChannelURL + "/videos' target='_blank'>" + channelTitle + "</a></div>";
		videosOuter += "<div class='video_list'>";
		videos = '';
		$.each(data.items, videoHTML);
		if( videos !== '' ) {
			videosOuter += videos;
		} else {
			videosOuter += "<i>no videos found</i>";
		}
		videosOuter += "</div>";
		videosOuter += "<div class='close_channel'>&times;</div>";
		videosOuter += "</div>";

		$("#videos").append( videosOuter );
	}

	function handleRSS(data) {
		if( data.length == 0 ) { return; }

		var $channel = $(data).find("channel");

		var channelTitle = $channel.find("title:first").text();
		var channelURL =  $channel.find("link:first").text();
		var imageURL =  $channel.find("image:first url").text();

		videosOuter = "<div class='channel'>";
		videosOuter += "<div class='channel_title'><a href='" + channelURL + "' target='_blank'>" + channelTitle + "</a></div>";
		videosOuter += "<div class='video_list'>";
		videos = '';

		var rssVids = [];
		$channel.find("item").slice(0,10).each(function () {
			$el = $(this);
			rssVids.push({
				"snippet": {
					"title": $el.find("title").text(),
					"resourceId": {
						"videoId": $el.find("guid").text()
					},
					"thumbnails": {
						"medium": {"url": imageURL}
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
		videosOuter += "<div class='close_channel'>&times;</div>";
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

				$("#" + v.id + " .video_duration").text(durationStr);
			});
		});
	}

	function getLiveBroadcasts() {
		url = apiLiveBroadcastURL + "&key=" + key + "&id=" + ids.join(",");
		$.get(url, function(data) {
			$.each(data.items, function(k,v) {
				if( v.snippet.liveBroadcastContent === "upcoming" ) {
					$("#" + v.id + " .video_thumb img").addClass('grey-out');
				}
			});
		});
	}

	function videoHTML(k,v) {
		if( hideOldCheck &&  moment().subtract(hideOldDays, "days").isAfter(v.snippet.publishedAt) ) {
			return;
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
		div += "<div class='video_thumb'><a href='" + watch + "'><img src='" + v.snippet.thumbnails.medium.url + "'></a></div>";
		div += "<div class='video_title' title='" + fullTitle + "'>" + title + "</div>";
		if( 'duration' in v.snippet && v.snippet.duration !== "" ) {
			div += "<div class='video_duration'>" + v.snippet.duration + "</div>";
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
}());
