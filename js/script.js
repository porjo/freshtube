var channelURL = "https://www.googleapis.com/youtube/v3/channels?part=contentDetails";
var playlistURL = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet";
var durationURL = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails";
var watchURL = "https://www.youtube.com/watch";

var channelRe = /youtube\.com\/channel\/([^\/]+)\/?/;
var userRe = /youtube\.com\/user\/([^\/]+)\/?/;


(function() {

	var stepCount = 0;
	var ids = [];
	var videos = "";
	var key = "";
	var lines = [];

	if (typeof(Storage) !== "undefined") {
		$("#apikey").val(localStorage.getItem("apikey"));
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

	function refresh() {
		key = $("#apikey").val();
		stepCount = 0;
		ids = [];
		var lines = $("#video_urls").val().split(/\n/);
		$("#videos").html('');

		if (typeof(Storage) !== "undefined") {
			localStorage.setItem("lines", JSON.stringify(lines));
			localStorage.setItem("apikey", key);
		}

		$.each(lines, function(k, line) {
			if( line.trim() == "" ) {return; }
			$("#search_input").slideUp();
			var url = channelURL + "&key=" + key;
			var chanMatches = line.match(channelRe);
			var userMatches = line.match(userRe);
			if( chanMatches && chanMatches.length > 1 ) {
				url += "&id=" + chanMatches[1];
			} else if( userMatches && userMatches.length > 1 ) {
				url += "&forUsername=" + userMatches[1];
			} else {
				id = line.trim();
				if( id.length == 24 ) {
					url += "&id=" + id;
				} else {
					url += "&forUsername=" + id;
				}
			}
			stepCount++;
			$.get(url, handleChannel);
		});
	}

	function handleChannel(data) {
		stepCount--;
		if( data.items.length == 0 ) { return; }
		var playlistID = data.items[0].contentDetails.relatedPlaylists.uploads;
		url = playlistURL + "&key=" + key + "&playlistId=" + playlistID;
		stepCount++;
		$.get(url, handlePlaylist);
	}

	function handlePlaylist(data) {
		stepCount--;
		if( data.items.length == 0 ) { return; }
		videos = "<div class='channel'>";
		var channelTitle = data.items[0].snippet.channelTitle;
		videos += "<div class='channel_title'>" + channelTitle + "</div>";
		videos += "<div class='video_list'>";
		$.each(data.items, videoHTML);
		videos += "</div>";
		videos += "<div class='close_channel'></div>";
		videos += "</div>";
		$("#videos").append( videos );

		if(stepCount == 0) {
			getDurations();
		}
	}

	function getDurations() {
		url = durationURL + "&key=" + key + "&id=" + ids.join(",");
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

	function videoHTML(k,v) {
		var fullTitle = v.snippet.title;
		var title = v.snippet.title;
		if( title.length > 50 ) {
			title = title.substring(0,50) + "...";
		}

		var id = v.snippet.resourceId.videoId;
		ids.push(id);

		var div = "<div class='video' id='" + id + "'>"
		var watch = watchURL + "?v=" + id;
		div += "<div class='video_thumb'><a href='" + watch + "'><img src='" + v.snippet.thumbnails.medium.url + "'></a></div>";
		div += "<div class='video_title' title='" + fullTitle + "'>" + title + "</div>";
		div += "<div class='video_footer'>" + moment(v.snippet.publishedAt).fromNow() + "</div>";
		div += "<div class='video_duration'></div>";
		div += "</div>";

		videos += div;
	}
}());
