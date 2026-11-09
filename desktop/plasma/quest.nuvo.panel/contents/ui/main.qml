// Needs Plasma 6.4 or newer for the D-Bus QML module
import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami
import org.kde.plasma.workspace.dbus as DBus

PlasmoidItem {
    id: root

    readonly property string nuvoName: "quest.nuvo.Nuvo.Player"
    readonly property string mprisName: nuvoWatcher.registered ? String(nuvo.properties.MprisName ?? "") : ""
    readonly property var metadata: player.properties.Metadata ?? ({})
    readonly property string title: String(metadata["xesam:title"] ?? "")
    readonly property string artist: Array.isArray(metadata["xesam:artist"]) ? metadata["xesam:artist"].join(", ") : String(metadata["xesam:artist"] ?? "")
    readonly property string artUrl: String(metadata["mpris:artUrl"] ?? "")
    readonly property real lengthUs: Number(metadata["mpris:length"] ?? 0)
    readonly property real positionUs: Number(player.properties.Position ?? 0)
    readonly property string status: String(player.properties.PlaybackStatus ?? "Stopped")
    readonly property bool playing: status === "Playing"
    readonly property bool liked: Boolean(nuvo.properties.Liked)
    readonly property string lyricsLine: String(nuvo.properties.LyricsLine ?? "")
    readonly property bool live: mprisName !== "" && title !== "" && status !== "Stopped"
    readonly property color glow: artUrl !== "" && coverColors.average.a > 0 ? coverColors.average : Kirigami.Theme.highlightColor

    Plasmoid.icon: "quest.nuvo.Nuvo"
    Plasmoid.status: live ? PlasmaCore.Types.ActiveStatus : PlasmaCore.Types.HiddenStatus
    toolTipMainText: live ? title : "Nuvo"
    toolTipSubText: live ? artist : ""
    preferredRepresentation: compactRepresentation

    function call(service, path, iface, member) {
        if (service === "")
            return;
        DBus.SessionBus.asyncCall({
            "service": service,
            "path": path,
            "iface": iface,
            "member": member,
            "arguments": []
        }, () => {}, (reply) => console.warn("Nuvo:", member, reply.error?.message));
    }
    function playerCall(member) {
        call(mprisName, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", member);
    }
    function nuvoCall(member) {
        call(nuvoWatcher.registered ? nuvoName : "", "/quest/nuvo/Nuvo/Player", nuvoName, member);
    }
    function formatTime(us) {
        const total = Math.max(0, Math.floor(us / 1e6));
        return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
    }

    DBus.DBusServiceWatcher {
        id: nuvoWatcher
        busType: DBus.BusType.Session
        watchedService: root.nuvoName
    }

    DBus.Properties {
        id: nuvo
        busType: DBus.BusType.Session
        service: nuvoWatcher.registered ? root.nuvoName : ""
        path: "/quest/nuvo/Nuvo/Player"
        iface: root.nuvoName
    }

    DBus.Properties {
        id: player
        busType: DBus.BusType.Session
        service: root.mprisName
        path: "/org/mpris/MediaPlayer2"
        iface: "org.mpris.MediaPlayer2.Player"
    }

    Kirigami.ImageColors {
        id: coverColors
        source: root.artUrl
    }
    onArtUrlChanged: coverColors.update()

    // MPRIS does not signal the position, so the open card asks once a second
    Timer {
        interval: 1000
        repeat: true
        triggeredOnStart: true
        running: root.expanded && root.live
        onTriggered: player.update("Position")
    }

    compactRepresentation: MouseArea {
        id: compact
        Layout.minimumWidth: row.implicitWidth
        Layout.preferredWidth: row.implicitWidth
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton
        hoverEnabled: true
        onClicked: (mouse) => {
            if (mouse.button === Qt.MiddleButton)
                root.playerCall("PlayPause");
            else
                root.expanded = !root.expanded;
        }
        onWheel: (wheel) => root.playerCall(wheel.angleDelta.y > 0 ? "Previous" : "Next")

        RowLayout {
            id: row
            anchors.verticalCenter: parent.verticalCenter
            spacing: Kirigami.Units.smallSpacing * 2

            Kirigami.ShadowedImage {
                Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
                Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
                source: root.artUrl
                fillMode: Image.PreserveAspectCrop
                radius: 4
                visible: root.artUrl !== ""
            }
            Kirigami.Icon {
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
                source: Qt.resolvedUrl("../icons/nuvo-symbolic.svg")
                isMask: true
                color: Kirigami.Theme.textColor
                visible: root.artUrl === ""
            }
            PlasmaComponents3.Label {
                Layout.maximumWidth: Kirigami.Units.gridUnit * 12
                text: root.title
                elide: Text.ElideRight
                font.weight: Font.Medium
                opacity: root.playing ? 1 : 0.6
            }
        }
    }

    fullRepresentation: ColumnLayout {
        Layout.preferredWidth: Kirigami.Units.gridUnit * 20
        Layout.minimumWidth: Kirigami.Units.gridUnit * 16
        spacing: Kirigami.Units.largeSpacing

        Kirigami.PlaceholderMessage {
            Layout.fillWidth: true
            visible: !root.live
            icon.source: Qt.resolvedUrl("../icons/nuvo-symbolic.svg")
            text: "Nothing is playing in Nuvo"
        }

        RowLayout {
            Layout.fillWidth: true
            visible: root.live
            spacing: Kirigami.Units.largeSpacing + Kirigami.Units.smallSpacing

            Kirigami.ShadowedImage {
                Layout.preferredWidth: Kirigami.Units.gridUnit * 4
                Layout.preferredHeight: Kirigami.Units.gridUnit * 4
                source: root.artUrl
                fillMode: Image.PreserveAspectCrop
                radius: 10
                color: Qt.alpha(Kirigami.Theme.textColor, 0.15)
                shadow.size: 22
                shadow.yOffset: 6
                shadow.color: Qt.alpha(root.glow, 0.55)

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        root.expanded = false;
                        root.nuvoCall("Show");
                    }
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2

                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    text: root.title
                    elide: Text.ElideRight
                    font.weight: Font.Bold
                    font.pointSize: Kirigami.Theme.defaultFont.pointSize * 1.1
                }
                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    text: root.artist
                    elide: Text.ElideRight
                    opacity: 0.65
                }
                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    Layout.topMargin: Kirigami.Units.smallSpacing
                    text: root.lyricsLine
                    elide: Text.ElideRight
                    font.weight: Font.DemiBold
                    visible: text !== ""
                }
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            visible: root.live
            spacing: Kirigami.Units.smallSpacing

            Rectangle {
                id: rail
                Layout.fillWidth: true
                implicitHeight: 4
                radius: 2
                color: Qt.alpha(Kirigami.Theme.textColor, 0.2)

                Rectangle {
                    height: parent.height
                    radius: 2
                    color: root.glow
                    width: root.lengthUs > 0 ? rail.width * Math.min(1, root.positionUs / root.lengthUs) : 0
                    Behavior on width {
                        NumberAnimation {
                            duration: 1000
                        }
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true
                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    text: root.formatTime(root.positionUs)
                    font: Kirigami.Theme.smallFont
                    opacity: 0.65
                }
                PlasmaComponents3.Label {
                    text: root.lengthUs > 0 ? root.formatTime(root.lengthUs) : ""
                    font: Kirigami.Theme.smallFont
                    opacity: 0.65
                }
            }
        }

        RowLayout {
            Layout.alignment: Qt.AlignHCenter
            visible: root.live
            spacing: Kirigami.Units.largeSpacing

            PlasmaComponents3.ToolButton {
                Accessible.name: "Dislike"
                onClicked: root.nuvoCall("Dislike")
                contentItem: Kirigami.Icon {
                    implicitWidth: Kirigami.Units.iconSizes.small
                    implicitHeight: Kirigami.Units.iconSizes.small
                    source: Qt.resolvedUrl("../icons/nuvo-dislike-symbolic.svg")
                    isMask: true
                    color: Kirigami.Theme.textColor
                }
            }
            PlasmaComponents3.ToolButton {
                icon.name: "media-skip-backward"
                Accessible.name: "Previous"
                onClicked: root.playerCall("Previous")
            }
            PlasmaComponents3.ToolButton {
                icon.name: root.playing ? "media-playback-pause" : "media-playback-start"
                icon.width: Kirigami.Units.iconSizes.medium
                icon.height: Kirigami.Units.iconSizes.medium
                Accessible.name: root.playing ? "Pause" : "Play"
                onClicked: root.playerCall("PlayPause")
            }
            PlasmaComponents3.ToolButton {
                icon.name: "media-skip-forward"
                Accessible.name: "Next"
                onClicked: root.playerCall("Next")
            }
            PlasmaComponents3.ToolButton {
                Accessible.name: root.liked ? "Remove like" : "Like"
                onClicked: root.nuvoCall("ToggleLike")
                contentItem: Kirigami.Icon {
                    implicitWidth: Kirigami.Units.iconSizes.small
                    implicitHeight: Kirigami.Units.iconSizes.small
                    source: Qt.resolvedUrl(root.liked ? "../icons/nuvo-liked-symbolic.svg" : "../icons/nuvo-like-symbolic.svg")
                    isMask: true
                    color: root.liked ? root.glow : Kirigami.Theme.textColor
                }
            }
        }
    }
}
