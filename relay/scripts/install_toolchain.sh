GAMES=$1
OWNER=$2
REPO=$3

cd "${GAMES}"

echo "Read toolchain."
TOOLCHAIN=$(head -n 1 "${OWNER}/${REPO}/lean-toolchain" | tr -d '\r')

echo "Install toolchain"
elan toolchain install "${TOOLCHAIN}"
