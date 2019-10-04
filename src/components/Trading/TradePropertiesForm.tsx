import BigNumber from "big.js"
import throttle from "lodash.throttle"
import React from "react"
import { Asset, Horizon } from "stellar-sdk"
import InputLabel from "@material-ui/core/InputLabel"
import TextField from "@material-ui/core/TextField"
import { makeStyles } from "@material-ui/core/styles"
import CallMadeIcon from "@material-ui/icons/CallMade"
import CallReceivedIcon from "@material-ui/icons/CallReceived"
import theme, { breakpoints } from "../../theme"
import { formatBalance } from "../Account/AccountBalances"
import AssetSelector from "../Form/AssetSelector"
import { Box, HorizontalLayout, VerticalLayout } from "../Layout/Box"
import { HorizontalMargin } from "../Layout/Spacing"
import TradingPrice from "./TradingPrice"

const useTradeFormStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",

    [breakpoints.down(600)]: {
      alignItems: "stretch",
      flexDirection: "column"
    }
  },
  tradePairInput: {
    display: "flex",
    alignItems: "center",
    flexBasis: "50%",
    margin: "24px -1.5vw",
    padding: "0 1.5vw",

    [breakpoints.down(600)]: {
      flexBasis: "auto",
      margin: "24px 0",
      padding: 0
    }
  },
  displayPrice: {
    justifyContent: "center",
    flexBasis: "auto",
    order: 3,
    width: "100%",

    [breakpoints.down(600)]: {
      marginTop: 0,
      marginBottom: 12,
      order: "initial"
    }
  },
  rowIcon: {
    color: theme.palette.action.disabled,
    fontSize: "300%",
    marginRight: "calc(8px + 1.5vw)"
  },
  rowIconLabel: {
    marginTop: -12,
    textAlign: "center"
  }
})

interface EditableAmount {
  field: "buying" | "selling"
  value: string
}

interface ManualPrice {
  editingNow: boolean
  error?: Error
  value?: string
}

interface TradePropertiesFormProps {
  buying: Asset
  buyingAmount: BigNumber
  buyingBalance: string
  estimatedReturn: BigNumber
  manualPrice: BigNumber | undefined
  onSelectAssets: (assets: { buying: Asset; selling: Asset }) => void
  onSetBuyingAmount: (amount: BigNumber) => void
  onSetSellingAmount: (amount: BigNumber) => void
  onSetManualPrice: (price: BigNumber) => void
  price: BigNumber
  selling: Asset
  sellingAmount: BigNumber
  sellingBalance: string
  trustlines: Horizon.BalanceLine[]
}

function TradePropertiesForm(props: TradePropertiesFormProps) {
  const classes = useTradeFormStyles()
  const [editableAmount, setEditableAmount] = React.useState<EditableAmount>({ field: "selling", value: "" })
  const [manualPrice, setManualPrice] = React.useState<ManualPrice>({ editingNow: false })
  const [priceMode, setPriceMode] = React.useState<"fixed-buying" | "fixed-selling">("fixed-selling")

  const bigNumberToInputValue = (bignum: BigNumber) => formatBalance(bignum, { minimumSignificants: 3 })

  const buyingAmountString =
    editableAmount.field === "buying" ? editableAmount.value : bigNumberToInputValue(props.buyingAmount)

  const sellingAmountString =
    editableAmount.field === "selling" ? editableAmount.value : bigNumberToInputValue(props.sellingAmount)

  const applyManualPrice = () => {
    if (!manualPrice.value || !/^[0-9]+(\.[0-9]+)?$/.test(manualPrice.value)) {
      setManualPrice({
        editingNow: false,
        error: Error("Invalid price entered.")
      })
      return
    }

    setManualPrice({
      editingNow: false
    })

    const price = priceMode === "fixed-buying" ? BigNumber(1).div(manualPrice.value) : BigNumber(manualPrice.value)

    props.onSetManualPrice(price)

    if (editableAmount.field === "buying") {
      props.onSetSellingAmount(props.buyingAmount.div(price))
    } else {
      props.onSetBuyingAmount(props.sellingAmount.mul(price))
    }
  }

  const dismissManualPrice = () => {
    setManualPrice({
      editingNow: false
    })
  }

  const setBuying = (newBuyingAsset: Asset) => {
    const swapSelection = newBuyingAsset.equals(props.selling) && !newBuyingAsset.equals(props.buying)

    props.onSelectAssets({
      buying: newBuyingAsset,
      selling: swapSelection ? props.buying : props.selling
    })
  }

  const setSelling = (newSellingAsset: Asset) => {
    const swapSelection = newSellingAsset.equals(props.buying) && !newSellingAsset.equals(props.selling)

    props.onSelectAssets({
      buying: swapSelection ? props.selling : props.buying,
      selling: newSellingAsset
    })
  }

  const updateManualPrice = React.useCallback((value: string) => {
    setManualPrice({
      editingNow: true,
      value
    })
  }, [])

  const startEditingPrice = React.useCallback(() => {
    const price = priceMode === "fixed-buying" ? BigNumber(1).div(props.price) : props.price
    setManualPrice({
      editingNow: true,
      value: price.toFixed(7)
    })
  }, [props.price, priceMode])

  const togglePriceMode = React.useCallback(
    () => setPriceMode(prev => (prev === "fixed-buying" ? "fixed-selling" : "fixed-buying")),
    []
  )

  const updateAmount = throttle((field: "buying" | "selling", event: React.ChangeEvent<HTMLInputElement>) => {
    const amount = event.target.value

    setEditableAmount({
      field,
      value: amount
    })

    if (!Number.isNaN(Number.parseFloat(amount))) {
      const setter = field === "buying" ? props.onSetBuyingAmount : props.onSetSellingAmount
      setter(BigNumber(amount))
    }
  }, 300)

  const updateEditingField = (field: "buying" | "selling") => {
    setEditableAmount(prev => ({
      field,
      value:
        prev.field === field
          ? prev.value
          : field === "buying"
          ? bigNumberToInputValue(props.buyingAmount)
          : bigNumberToInputValue(props.sellingAmount)
    }))
  }

  return (
    <Box className={classes.root}>
      <HorizontalLayout className={classes.tradePairInput}>
        <VerticalLayout>
          <InputLabel className={classes.rowIconLabel}>Selling</InputLabel>
          <CallMadeIcon className={classes.rowIcon} />
        </VerticalLayout>
        <AssetSelector onChange={setSelling} trustlines={props.trustlines} value={props.selling} />
        <HorizontalMargin size={16} />
        <TextField
          autoFocus={process.env.PLATFORM !== "ios"}
          inputProps={{
            style: { height: 27, textAlign: "right" }
          }}
          onChange={event => updateAmount("selling", event as React.ChangeEvent<HTMLInputElement>)}
          onFocus={() => updateEditingField("selling")}
          placeholder={`Max. ${props.sellingBalance}`}
          style={{ flexGrow: 1, flexShrink: 1, marginLeft: "auto", maxWidth: 200 }}
          type="number"
          value={sellingAmountString}
        />
      </HorizontalLayout>
      <HorizontalLayout className={`${classes.tradePairInput} ${classes.displayPrice}`}>
        <TradingPrice
          buying={props.buying}
          inputError={manualPrice.error}
          isEditingPrice={manualPrice.editingNow}
          isPriceSwitched={priceMode === "fixed-buying"}
          manualPrice={manualPrice.value}
          onApplyManualPrice={applyManualPrice}
          onDismissManualPrice={dismissManualPrice}
          onEditPrice={startEditingPrice}
          onSetManualPrice={updateManualPrice}
          onSwitchPriceAssets={togglePriceMode}
          price={props.price}
          selling={props.selling}
        />
      </HorizontalLayout>
      <HorizontalLayout className={classes.tradePairInput}>
        <VerticalLayout>
          <InputLabel className={classes.rowIconLabel}>Buying</InputLabel>
          <CallReceivedIcon className={classes.rowIcon} />
        </VerticalLayout>
        <AssetSelector onChange={setBuying} trustlines={props.trustlines} value={props.buying} />
        <HorizontalMargin size={16} />
        <TextField
          inputProps={{
            style: { height: 27, textAlign: "right" }
          }}
          onChange={event => updateAmount("buying", event as React.ChangeEvent<HTMLInputElement>)}
          onFocus={() => updateEditingField("buying")}
          placeholder={`Max. ${props.buyingBalance}`}
          style={{ flexGrow: 1, flexShrink: 1, marginLeft: "auto", maxWidth: 200 }}
          type="number"
          value={buyingAmountString}
        />
      </HorizontalLayout>
    </Box>
  )
}

export default React.memo(TradePropertiesForm)