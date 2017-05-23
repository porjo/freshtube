var channelURL = "https://www.googleapis.com/youtube/v3/channels?part=contentDetails";
var playlistURL = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet";
var durationURL = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails";
var watchURL = "https://www.youtube.com/watch";

(function() {

	var count = 0;
	var ids = [];
	var key = $("#apikey").val();
	var videos = "";

	$("#refresh_button").click(function() {
		count = 0;
		var usernames = $("#video_urls").val().split(/\n/);
		$("#videos").html('');
		$.each(usernames, function(k, username) {
			username = username.trim();
			if( username == "" ) {return; }
			var url = channelURL + "&key=" + key + "&forUsername=" + username;
			count++;
			$.get(url, handleChannel);
		});
	});

	function handleChannel(data) {
		count--;
		if( data.items.length == 0 ) { return; }
		var playlistID = data.items[0].contentDetails.relatedPlaylists.uploads;
		url = playlistURL + "&key=" + key + "&playlistId=" + playlistID;
		count++;
		$.get(url, handlePlaylist);
	}

	function handlePlaylist(data) {
		count--;
		if( data.items.length == 0 ) { return; }
		videos = "<div class='channel'>";
		var channelTitle = data.items[0].snippet.channelTitle;
		videos += "<div class='channel_title'>" + channelTitle + "</div>";
		videos += "<div class='video_list'>";
		$.each(data.items, videoHTML);
		videos += "</div>";
		videos += "</div>";
		$("#videos").append( videos );

		if(count == 0) {
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
